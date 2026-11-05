import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"

type Props = {
  children: ReactNode
  fallbackTitle?: string
  /** 变化时自动清除错误（路由级边界用 pathname：导航即自愈，不重挂 children） */
  resetKey?: string
}

type State = {
  error: Error | null
}

/** 错误边界：渲染期抛错时不白屏；resetKey 变化时自动复位 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack)
  }

  componentDidUpdate(prevProps: Props): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  private reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-5 py-16 text-center">
        <h1 className="text-lg font-semibold text-foreground">
          {this.props.fallbackTitle ?? "页面出错了"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {error.message || "未知错误"}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={this.reset}>重试</Button>
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = "/cool-18"
            }}
          >
            回首页
          </Button>
        </div>
      </div>
    )
  }
}
