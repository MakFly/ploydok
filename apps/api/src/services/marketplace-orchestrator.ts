// SPDX-License-Identifier: AGPL-3.0-only
import { nanoid } from "nanoid"
import { eq } from "drizzle-orm"
import { services, projects } from "@ploydok/db"
import {
  insertService,
  updateServiceStatus,
  updateServiceContainers,
  markServiceDeleting,
  uniqueServiceSlug,
  getServiceForUser,
} from "@ploydok/db/queries"
import type { ServiceRow, Db } from "@ploydok/db"
import { resolveTemplate } from "@ploydok/shared"
import { childLogger } from "../logger"
import type { Agent } from "../agent"

import {
  composeToContainers,
  type ComposeContainer,
} from "../marketplace/compose-to-containers"

function topoOrder(containers: ComposeContainer[]): string[] {
  const names = new Set(containers.map((c) => c.name))
  const visited = new Set<string>()
  const order: string[] = []

  function visit(name: string) {
    if (visited.has(name)) return
    visited.add(name)
    const spec = containers.find((c) => c.name === name)
    for (const dep of spec?.dependsOn ?? []) {
      if (names.has(dep)) visit(dep)
    }
    order.push(name)
  }

  for (const c of containers) visit(c.name)
  return order
}

const log = childLogger("marketplace-orchestrator")

export interface OrchestratorDeps {
  agent: Pick<
    Agent,
    | "imagePull"
    | "containerCreate"
    | "containerStart"
    | "containerStop"
    | "containerRemove"
  >
  db: Db
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
}

export async function installFromTemplate(
  deps: OrchestratorDeps,
  userId: string,
  input: {
    projectId: string
    templateId: string
    templateVersion: string
    name: string
    compose: string
  }
): Promise<ServiceRow> {
  const { agent, db } = deps

  const projectRows = await db
    .select({ id: projects.id, owner_id: projects.owner_id })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1)
  if (!projectRows[0]) {
    throw Object.assign(new Error("Project not found"), { code: "NOT_FOUND" })
  }
  if (projectRows[0].owner_id !== userId) {
    throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" })
  }

  const serviceId = nanoid()
  const baseSlug = slugify(input.name) || "service"
  const slug = await uniqueServiceSlug(db, input.projectId, baseSlug)

  const { composeResolved, generatedVars, domain } = resolveTemplate(
    input.compose,
    {
      projectSlug: slug,
    }
  )

  const containers = composeToContainers({
    compose: composeResolved,
    servicePrefix: `ploydok-svc-${slug}`,
    network: "ploydok-public",
    labels: {
      "ploydok.kind": "service",
      "ploydok.service_id": serviceId,
    },
  })
  const deployOrder = topoOrder(containers)

  const row = await insertService(db, {
    id: serviceId,
    project_id: input.projectId,
    name: input.name,
    slug,
    template_id: input.templateId,
    template_version: input.templateVersion,
    status: "pending",
    compose_raw: composeResolved,
    generated_env: generatedVars,
    domain,
    container_ids: [],
  })

  // Fire-and-forget: pull → create → start each container in topological order
  ;(async () => {
    try {
      const containerIds: string[] = []

      for (const containerName of deployOrder) {
        const spec = containers.find((c) => c.name === containerName)
        if (!spec) continue

        for await (const _progress of agent.imagePull({
          image: spec.image,
          registryAuth: undefined,
        })) {
          // drain progress stream
        }

        const createRes = await agent.containerCreate({
          name: spec.name,
          image: spec.image,
          env: spec.env,
          labels: spec.labels,
          network: spec.networks[0] ?? "",
          networks: spec.networks,
          ports: spec.ports,
          volumes: spec.volumes,
          command: spec.command,
          restartPolicy: spec.restartPolicy,
          resourceLimits: undefined,
          healthcheck: spec.healthcheck
            ? {
                test: spec.healthcheck.test,
                intervalSeconds: spec.healthcheck.intervalSeconds ?? 0,
                timeoutSeconds: spec.healthcheck.timeoutSeconds ?? 0,
                retries: spec.healthcheck.retries ?? 0,
                startPeriodSeconds: spec.healthcheck.startPeriodSeconds ?? 0,
              }
            : undefined,
          user: "",
        })

        containerIds.push(createRes.containerId)
        await agent.containerStart({ containerId: createRes.containerId })
      }

      await updateServiceContainers(db, serviceId, containerIds)
      await updateServiceStatus(db, serviceId, "running")
      log.info(
        { serviceId, slug, containerCount: containerIds.length },
        "service deployed"
      )
    } catch (err) {
      log.error({ err, serviceId }, "service install failed")
      await updateServiceStatus(db, serviceId, "failed").catch((e) =>
        log.error(
          { e },
          "failed to update service status after install failure"
        )
      )
    }
  })()

  return row
}

export async function startService(
  deps: OrchestratorDeps,
  userId: string,
  serviceId: string
): Promise<void> {
  const { agent, db } = deps

  const svc = await getServiceForUser(db, serviceId, userId)
  if (!svc)
    throw Object.assign(new Error("Service not found"), { code: "NOT_FOUND" })
  if (svc.status !== "stopped" && svc.status !== "failed") {
    throw Object.assign(
      new Error(`Service is not in a startable state (current: ${svc.status})`),
      { code: "CONFLICT" }
    )
  }

  for (const containerId of svc.container_ids ?? []) {
    await agent.containerStart({ containerId })
  }
  await updateServiceStatus(db, serviceId, "running")
}

export async function stopService(
  deps: OrchestratorDeps,
  userId: string,
  serviceId: string
): Promise<void> {
  const { agent, db } = deps

  const svc = await getServiceForUser(db, serviceId, userId)
  if (!svc)
    throw Object.assign(new Error("Service not found"), { code: "NOT_FOUND" })
  if (svc.status !== "running") {
    throw Object.assign(
      new Error(`Service is not running (current: ${svc.status})`),
      { code: "CONFLICT" }
    )
  }

  for (const containerId of [...(svc.container_ids ?? [])].reverse()) {
    await agent.containerStop({ containerId, timeoutSeconds: 10 })
  }
  await updateServiceStatus(db, serviceId, "stopped")
}

export async function deleteService(
  deps: OrchestratorDeps,
  userId: string,
  serviceId: string
): Promise<void> {
  const { agent, db } = deps

  const svc = await getServiceForUser(db, serviceId, userId)
  if (!svc)
    throw Object.assign(new Error("Service not found"), { code: "NOT_FOUND" })

  await markServiceDeleting(db, serviceId)

  for (const containerId of svc.container_ids ?? []) {
    try {
      await agent.containerStop({ containerId, timeoutSeconds: 10 })
    } catch (err) {
      log.warn({ err, containerId }, "container stop warning during delete")
    }
    try {
      await agent.containerRemove({
        containerId,
        force: true,
        removeVolumes: true,
      })
    } catch (err) {
      log.warn({ err, containerId }, "container remove warning during delete")
    }
  }

  // TODO(Wave 3): removeCaddyRoute(svc.domain) when Caddy integration is ready

  await db.delete(services).where(eq(services.id, serviceId))
  log.info({ serviceId, name: svc.name }, "service deleted")
}
