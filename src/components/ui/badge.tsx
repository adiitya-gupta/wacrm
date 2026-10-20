import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        success: "bg-[#DCFCE7] text-[#16A34A] border-[#86EFAC]/70 dark:bg-[#16A34A]/15 dark:text-[#4ADE80] dark:border-[#16A34A]/30",
        info: "bg-[#E0F2FE] text-[#0284C7] border-[#BAE6FD]/80 dark:bg-[#0284C7]/15 dark:text-[#38BDF8] dark:border-[#0284C7]/30",
        pending: "bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]/70 dark:bg-[#D97706]/15 dark:text-[#FBBF24] dark:border-[#D97706]/30",
        error: "bg-[#FEE2E2] text-[#DC2626] border-[#FCA5A5]/70 dark:bg-[#DC2626]/15 dark:text-[#F87171] dark:border-[#DC2626]/30",
        neutral: "bg-[#F1F5F9] text-[#64748B] border-[#E5E9F2] dark:bg-muted dark:text-muted-foreground dark:border-border",
        teal: "bg-[#CCFBF1] text-[#0F766E] border-[#99F6E4]/70 dark:bg-[#14B8A6]/15 dark:text-[#2DD4BF] dark:border-[#14B8A6]/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
