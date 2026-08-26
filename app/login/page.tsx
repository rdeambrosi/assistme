"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Contraseña incorrecta");
        return;
      }
      router.push(params.get("next") || "/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg0)",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          width: 280,
          background: "var(--bg1)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 24,
        }}
      >
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          COMMS/HUB
        </span>
        <input
          type="password"
          autoFocus
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            background: "var(--bg2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "10px 12px",
            color: "var(--text-primary)",
            fontSize: 14,
          }}
        />
        {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
        <button
          type="submit"
          disabled={loading}
          className="btn btn-approve"
          style={{ flex: "none" }}
        >
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
