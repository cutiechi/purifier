import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  /** 服务端确认无会话（me 401 / callback 失败 / 登出）；false 不代表已登录 */
  loggedOut: boolean
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
  /** 服务端确认无会话（me 401 / callback 失败 / 登出）；false 不代表已登录 */
  const [loggedOut, setLoggedOut] = useState(false)
  /** fetch 401 包装闭包读取的最新 enabled（闭包不随 state 更新） */
  const enabledRef = useRef(enabled)

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
            setLoggedOut(false)
          } else if (meRes.status === 401) {
            // 仅 401 视为未登录；5xx 等保持未知，站点照常可用
            setUser(null)
            setLoggedOut(true)
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

  // 同步最新 enabled 到 ref，供下方 fetch 包装闭包读取
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  // 全局 401 拦截：enabled 时同源 /api/ 请求 401 视为会话失效 → 清用户并跳登录页。
  // keepalive 上报（sendBeacon/keepalive fetch）与页面隐藏（pagehide → visibilityState
  // 已是 hidden）都不跳转，避免卸载中的回调触发导航。
  useEffect(() => {
    const orig = window.fetch
    // bun 的 typeof fetch 在函数对象上带 preconnect 命名空间属性（浏览器端无），保留避免覆盖
    const preconnect = orig.preconnect
    const origFetch = orig.bind(window)
    window.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await origFetch(input, init)
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        const isApi =
          url.startsWith("/api/") ||
          url.startsWith(`${window.location.origin}/api/`)
        if (
          res.status === 401 &&
          isApi &&
          !init?.keepalive &&
          document.visibilityState === "visible"
        ) {
          if (!enabledRef.current) {
            const cfg = await origFetch(api.authConfig)
            if (cfg.ok) {
              const data = (await cfg.json()) as { enabled: boolean }
              enabledRef.current = data.enabled
              setEnabled(data.enabled)
            }
          }
          if (enabledRef.current) {
            setUser(null)
            const path = window.location.pathname
            if (path !== routes.login) {
              window.location.assign(
                `${routes.login}?from=${encodeURIComponent(path + window.location.search)}`
              )
            }
          }
        }
        return res
      },
      { preconnect }
    )
    return () => {
      window.fetch = orig
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
          setLoggedOut(true)
          const data = (await res.json().catch(() => null)) as {
            error?: string
          } | null
          return { error: data?.error || "unauthorized" }
        }
        const data = (await res.json()) as { ok: true; user: AuthMe }
        setUser(data.user)
        setLoggedOut(false)
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
    setLoggedOut(true)
    navigate(routes.login)
  }, [navigate])

  const value = useMemo(
    () => ({
      ready,
      enabled,
      loggedOut,
      user,
      buttonText,
      login,
      logout,
      completeCallback,
    }),
    [ready, enabled, loggedOut, user, buttonText, login, logout, completeCallback]
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
  // 反斜杠会被 WHATWG URL 解析当作正斜杠（/\\evil.com → //evil.com 跨源），一并拒绝
  if (raw.includes("\\") || raw.includes("://")) return "/"
  return raw
}

/** 未 ready 转圈；enabled 未登录把业务页导向 /login；未开启时 /login 回首页 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, enabled, loggedOut } = useAuth()
  const { pathname } = useLocation()

  if (!ready) return <Spinner />
  // 仅「确认未登录」（me 401）才拦到 /login；me 5xx 等未知态放行，避免误弹登录页
  if (enabled && loggedOut && pathname !== routes.login) {
    return (
      <Navigate
        to={`${routes.login}?from=${encodeURIComponent(
          pathname + window.location.search
        )}`}
        replace
      />
    )
  }
  if (!enabled && pathname === routes.login) {
    return <Navigate to={routes.home} replace />
  }
  return <>{children}</>
}
