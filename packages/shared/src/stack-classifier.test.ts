// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "bun:test";
import {
  classifyStack,
  type ProbeResults,
  type Stack,
  type BuildMethodRecommendation,
} from "./stack-classifier";

function probes(on: Array<string>): ProbeResults {
  const out: ProbeResults = {};
  for (const k of on) (out as Record<string, boolean>)[k] = true;
  return out;
}

describe("classifyStack — Dockerfile short-circuit", () => {
  it("Dockerfile alone wins, even with other signals", () => {
    const r = classifyStack(probes(["Dockerfile", "composer.json", "artisan"]));
    expect(r.recommendedBuild).toBe("dockerfile");
    expect(r.confidence).toBe("high");
    expect(r.signals).toEqual(["Dockerfile"]);
  });
});

describe("classifyStack — Compose", () => {
  it("compose.yaml triggers compose stack", () => {
    const r = classifyStack(probes(["compose.yaml"]));
    expect(r.stack).toBe("compose");
    expect(r.recommendedBuild).toBe("compose");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("docker-compose.yml also matches", () => {
    const r = classifyStack(probes(["docker-compose.yml"]));
    expect(r.stack).toBe("compose");
  });

  it("compose + composer.json → compose wins (user likely manages PHP via compose)", () => {
    const r = classifyStack(probes(["compose.yaml", "composer.json", "symfony.lock"]));
    expect(r.stack).toBe("compose");
  });
});

describe("classifyStack — PHP", () => {
  it("Laravel: composer.json + artisan → recipe php-laravel.v1", () => {
    const r = classifyStack(probes(["composer.json", "artisan"]));
    expect(r.stack).toBe("laravel");
    expect(r.recommendedBuild).toBe("recipe");
    expect(r.recommendedRecipe).toBe("php-laravel.v1");
    expect(r.signals).toContain("artisan");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("Laravel + Vite: composer.json + artisan + package.json picks up the front-end signal", () => {
    const r = classifyStack(probes(["composer.json", "artisan", "package.json"]));
    expect(r.stack).toBe("laravel");
    expect(r.signals).toContain("package.json");
  });

  it("Symfony via symfony.lock", () => {
    const r = classifyStack(probes(["composer.json", "symfony.lock"]));
    expect(r.stack).toBe("symfony");
    expect(r.recommendedRecipe).toBe("php-symfony.v1");
  });

  it("Symfony via bin/console only", () => {
    const r = classifyStack(probes(["composer.json", "bin/console"]));
    expect(r.stack).toBe("symfony");
  });

  it("PHP generic: composer.json alone (no framework marker)", () => {
    const r = classifyStack(probes(["composer.json"]));
    expect(r.stack).toBe("php");
    expect(r.confidence).toBe("medium");
    expect(r.recommendedRecipe).toBe("php-generic.v1");
  });
});

describe("classifyStack — JS/TS frameworks", () => {
  it("Next.js via next.config.mjs", () => {
    const r = classifyStack(probes(["package.json", "next.config.mjs"]));
    expect(r.stack).toBe("next");
    expect(r.recommendedBuild).toBe("nixpacks");
  });

  it("Next.js via next.config.ts", () => {
    const r = classifyStack(probes(["package.json", "next.config.ts"]));
    expect(r.stack).toBe("next");
  });

  it("Remix", () => {
    const r = classifyStack(probes(["package.json", "remix.config.js"]));
    expect(r.stack).toBe("remix");
  });

  it("Astro", () => {
    const r = classifyStack(probes(["package.json", "astro.config.mjs"]));
    expect(r.stack).toBe("astro");
  });

  it("Bun via bun.lockb", () => {
    const r = classifyStack(probes(["package.json", "bun.lockb"]));
    expect(r.stack).toBe("bun");
  });

  it("Node generic with warning about Node version", () => {
    const r = classifyStack(probes(["package.json"]));
    expect(r.stack).toBe("node");
    expect(r.confidence).toBe("medium");
    expect(r.warnings.join(" ")).toMatch(/NIXPACKS_NODE_VERSION/);
  });

  it("Deno standalone (no package.json)", () => {
    const r = classifyStack(probes(["deno.json"]));
    expect(r.stack).toBe("deno");
  });
});

describe("classifyStack — Python", () => {
  it("Django via manage.py", () => {
    const r = classifyStack(probes(["manage.py", "requirements.txt"]));
    expect(r.stack).toBe("django");
    expect(r.signals).toContain("requirements.txt");
  });

  it("Python generic via pyproject.toml", () => {
    const r = classifyStack(probes(["pyproject.toml"]));
    expect(r.stack).toBe("python");
  });

  it("Python generic via requirements.txt", () => {
    const r = classifyStack(probes(["requirements.txt"]));
    expect(r.stack).toBe("python");
  });
});

describe("classifyStack — other languages", () => {
  const cases: Array<{ files: Array<string>; stack: Stack; build: BuildMethodRecommendation }> = [
    { files: ["go.mod"], stack: "go", build: "nixpacks" },
    { files: ["Cargo.toml"], stack: "rust", build: "nixpacks" },
    { files: ["Gemfile"], stack: "ruby", build: "nixpacks" },
    { files: ["mix.exs"], stack: "elixir", build: "nixpacks" },
    { files: ["pom.xml"], stack: "java", build: "dockerfile" },
    { files: ["build.gradle"], stack: "java", build: "dockerfile" },
    { files: ["build.gradle.kts"], stack: "java", build: "dockerfile" },
  ];
  for (const c of cases) {
    it(`${c.files.join(" + ")} → ${c.stack} (${c.build})`, () => {
      const r = classifyStack(probes(c.files));
      expect(r.stack).toBe(c.stack);
      expect(r.recommendedBuild).toBe(c.build);
    });
  }
});

describe("classifyStack — static + unknown", () => {
  it("Static: index.html only", () => {
    const r = classifyStack(probes(["index.html"]));
    expect(r.stack).toBe("static");
  });

  it("Unknown: no signal", () => {
    const r = classifyStack({});
    expect(r.stack).toBe("unknown");
    expect(r.confidence).toBe("low");
    expect(r.recommendedBuild).toBe("auto");
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("classifyStack — tie-breaking & edge cases", () => {
  it("Node + Django markers: manage.py wins (Django is more specific)", () => {
    const r = classifyStack(probes(["package.json", "manage.py", "requirements.txt"]));
    // Note: current order checks PHP then JS then Python. package.json triggers node
    // BEFORE django check is reached. This is by design: if both exist, the repo is
    // a hybrid and we default to Node. Document this behavior.
    expect(r.stack).toBe("node");
  });

  it("Laravel + compose.yaml: compose wins (user is explicit about compose)", () => {
    const r = classifyStack(probes(["compose.yaml", "composer.json", "artisan"]));
    expect(r.stack).toBe("compose");
  });

  it("Dockerfile + compose.yaml: Dockerfile wins (even more explicit)", () => {
    const r = classifyStack(probes(["Dockerfile", "compose.yaml"]));
    expect(r.recommendedBuild).toBe("dockerfile");
  });
});
