import { useEffect, useRef, useState } from "react"
import {
  Navigate,
  useNavigate,
  useSearchParams,
} from "react-router-dom"
import { ErrorBox } from "@/components/ui-state"
import { safeFrom, useAuth } from "@/lib/auth"
import { routes } from "@/lib/routes"

const EXPIRED_TEXT = "登录链接已过期，请重新登录"

/** OIDC 登录页：全屏居中（不用 PageShell，避免未登录时带出业务导航） */
export default function LoginPage() {
  const { enabled, user, buttonText, login, completeCallback } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const didCallback = useRef(false)

  const code = searchParams.get("code")
  const from = searchParams.get("from")

  // IdP 回跳带 code：自动完成一次回调（ref 防 StrictMode 双跑重复用码）
  useEffect(() => {
    if (!code || didCallback.current) return
    didCallback.current = true
    setPending(true)
    void completeCallback(window.location.href).then((res) => {
      setPending(false)
      if ("ok" in res) {
        // replace 到目标页，URL 不再带 code，刷新不会重复用码
        navigate(safeFrom(from) || "/", { replace: true })
      } else if (res.error === "invalid_grant") {
        // code 已消费（可能过期/重复使用）：不自动再 POST，按钮重新登录
        setError(EXPIRED_TEXT)
      } else {
        setError(res.error)
      }
    })
  }, [code, from, completeCallback, navigate])

  if (enabled && user) {
    return <Navigate to={routes.home} replace />
  }

  const handleLogin = async () => {
    setPending(true)
    setError(null)
    try {
      await login()
    } catch (e) {
      setPending(false)
      setError(e instanceof Error ? e.message : "登录失败，请重试")
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4">
      <img
        src="/logo.png"
        alt="Purifier"
        width={56}
        height={56}
        className="size-14 object-contain"
      />
      <div className="w-full max-w-sm">
        {error ? <ErrorBox message={error} /> : null}
        <button
          type="button"
          onClick={() => void handleLogin()}
          disabled={pending}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {buttonText || "登录"}
        </button>
      </div>
    </div>
  )
}
