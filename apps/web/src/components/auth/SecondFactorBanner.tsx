// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { Button } from "@workspace/ui/components/button";
import type { Me } from "@ploydok/shared";

interface SecondFactorBannerProps {
  me: Me;
}

export function SecondFactorBanner({ me }: SecondFactorBannerProps): React.JSX.Element | null {
  const needsBanner = !me.has_passkey_plus && !me.has_backup_codes;
  const [downloading, setDownloading] = React.useState(false);
  const [downloaded, setDownloaded] = React.useState(false);

  if (!needsBanner) return null;

  const handleGenerateCodes = async (): Promise<void> => {
    setDownloading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}/auth/backup-codes/generate`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        },
      );
      if (!res.ok) throw new Error("Failed to generate backup codes");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ploydok-backup-codes.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDownloaded(true);
    } catch (err) {
      console.error("Failed to generate backup codes", err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      role="alert"
      className="mb-6 flex items-start gap-3 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4 text-yellow-700 dark:border-yellow-400/40 dark:bg-yellow-400/10 dark:text-yellow-300"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 shrink-0"
        aria-hidden="true"
      >
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>

      <div className="flex-1">
        <p className="font-medium">Génère tes codes de secours</p>
        <p className="mt-0.5 text-sm opacity-90">
          Si tu perds ta passkey, ces codes sont le seul moyen de récupérer ton compte. Télécharge-les
          et garde-les en lieu sûr.
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleGenerateCodes()}
            disabled={downloading || downloaded}
          >
            {downloaded ? "Codes téléchargés ✓" : downloading ? "Génération…" : "Générer les codes de secours"}
          </Button>
        </div>
      </div>
    </div>
  );
}
