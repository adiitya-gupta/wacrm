import Link from "next/link";
import { MessageSquare } from "lucide-react";

export function LegalFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-card/60 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/20">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sm text-foreground">Wattomation</span>
            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider -mt-0.5">
              by OPSIYS
            </span>
          </div>
        </Link>

        <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground font-medium">
          <Link href="/" className="hover:text-foreground transition-colors">
            Home
          </Link>
          <Link href="/pricing" className="hover:text-foreground transition-colors">
            Pricing
          </Link>
          <Link href="/privacy-policy" className="hover:text-foreground transition-colors font-medium">
            Privacy Policy
          </Link>
          <Link href="/terms-of-service" className="hover:text-foreground transition-colors font-medium">
            Terms of Service
          </Link>
          <Link href="/login" className="hover:text-foreground transition-colors">
            Sign In
          </Link>
          <Link href="/login" className="hover:text-foreground transition-colors">
            Get Started
          </Link>
        </div>

        <div className="text-xs text-muted-foreground text-center md:text-right">
          © {currentYear} Wattomation by OPSIYS. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

