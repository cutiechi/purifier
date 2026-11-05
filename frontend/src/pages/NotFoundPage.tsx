import { Link } from "react-router-dom"
import { PageHeader } from "@/components/page-header"
import { PageShell } from "@/components/page-shell"
import { forumRoutes } from "@/lib/routes"
import { buttonVariants } from "@/components/ui/button"

export default function NotFoundPage() {
  return (
    <PageShell>
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <PageHeader
          title="页面不存在"
          description="链接可能已失效，或地址输入有误。"
        />
        <Link
          to={forumRoutes.home}
          className={buttonVariants({ className: "min-h-10 px-4" })}
        >
          回到首页
        </Link>
      </div>
    </PageShell>
  )
}
