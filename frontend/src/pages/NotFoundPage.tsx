import { Link } from "react-router-dom"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { routes } from "@/lib/routes"

export default function NotFoundPage() {
  return (
    <PageShell>
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <PageHeader
          title="页面不存在"
          description="链接可能已失效，或地址输入有误。"
        />
        <Link
          to={routes.home}
          className="inline-flex min-h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          回到首页
        </Link>
      </div>
    </PageShell>
  )
}
