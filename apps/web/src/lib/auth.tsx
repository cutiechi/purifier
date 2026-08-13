import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import { Spinner } from "@/components/ui-state"
import { api, routes } from "@/lib/routes"

/** 与 core 的 AuthMe 同形（web 不依赖 @workspace/core） */
export type AuthMe = {
  enabled: boolean
  sub: string | null
  email: string | null
  name: string | null
}

type AuthConfigResponse = {
  enabled: boolean
  buttonText: string
}

type AuthContextValue = {
  ready: boolean
  enabled: boolean
  user: AuthMe | null
  /** 登录按钮文案（来自 GET /api/auth/config 的 buttonText） */
  buttonText: string
  login: () => Promise<void>
  logout: () => Promise<void>
  completeCallback: (
    url: string
  ) => Promise<{ ok: true } | { error: string }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [buttonText, setButtonText] = useState("登录")
  const [user, setUser] = useState<AuthMe | null>(null)

  // 启动拉一次 config；enabled 时再验 me（200 设用户，401 未登录）。
  // 拉取失败保持未 ready（AuthGate 转圈），不误判为公开站。
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(api.authConfig)
        const cfg = (await res.json()) as AuthConfigResponse
        if (cancelled) return
        setEnabled(cfg.enabled)
        setButtonText(cfg.buttonText)
        if (cfg.enabled) {
          const meRes = await fetch(api.authMe)
          if (cancelled) return
          if (meRes.ok) {
            const me = (await meRes.json()) as AuthMe
            setUser(me)
          } else {
            setUser(null)
          }
        }
        setReady(true)
      } catch {
        // 保持 ready=false
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async () => {
    const res = await fetch(api.authAuthorize, { method: "POST" })
    const data = (await res.json()) as { url?: string; error?: string }
    if (!res.ok || !data.url) {
      throw new Error(data.error || "获取登录链接失败")
    }
    window.location.assign(data.url)
  }, [])

  const completeCallback = useCallback(
    async (
      url: string
    ): Promise<{ ok: true } | { error: string }> => {
      try {
        const res = await fetch(api.authCallback, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string
          } | null
          return { error: data?.error || "unauthorized" }
        }
        const data = (await res.json()) as { ok: true; user: AuthMe }
        setUser(data.user)
        return { ok: true }
      } catch {
        return { error: "登录校验失败，请重试" }
      }
    },
    []
  )

  const logout = useCallback(async () => {
    await fetch(api.authLogout, { method: "POST" })
    setUser(null)
    navigate(routes.login)
  }, [navigate])

  const value = useMemo(
    () => ({
      ready,
      enabled,
      user,
      buttonText,
      login,
      logout,
      completeCallback,
    }),
    [ready, enabled, user, buttonText, login, logout, completeCallback]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return ctx
}

/** 回跳目标校验：仅允许站内相对路径（以 / 开头、非 //、不含 ://），防开放重定向 */
export function safeFrom(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/"
  }
  if (raw.includes("://")) return "/"
  return raw
}

/** 未 ready 转圈；enabled 未登录把业务页导向 /login；未开启时 /login 回首页 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, enabled, user } = useAuth()
  const { pathname } = useLocation()

  if (!ready) return <Spinner />
  if (enabled && !user && pathname !== routes.login) {
    return (
      <Navigate
        to={`${routes.login}?from=${encodeURIComponent(pathname)}`}
        replace
      />
    )
  }
  if (!enabled && pathname === routes.login) {
    return <Navigate to={routes.home} replace />
  }
  return <>{children}</>
}
