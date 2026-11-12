"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageSquare, Menu, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LegalHeaderProps {
  activePage?: "privacy" | "terms";
}

export function LegalHeader({ activePage }: LegalHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/20 transition-transform group-hover:scale-105">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-tight text-foreground">Wattomation</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold -mt-1">
              by OPSIYS
            </span>
          </div>
        </Link>

        {/* Desktop Nav Links */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
          <Link href="/" className="transition-colors hover:text-foreground">
            Home
          </Link>
          <Link href="/pricing" className="transition-colors hover:text-foreground">
            Pricing
          </Link>
          <Link
            href="/privacy-policy"
            className={`transition-colors ${
              activePage === "privacy" ? "text-primary font-semibold" : "hover:text-foreground"
            }`}
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms-of-service"
            className={`transition-colors ${
              activePage === "terms" ? "text-primary font-semibold" : "hover:text-foreground"
            }`}
          >
            Terms of Service
          </Link>
        </nav>

        {/* Desktop Actions */}
        <div className="hidden md:flex items-center gap-3">
          <Link href="/login">
            <Button variant="ghost" className="text-sm font-medium hover:text-foreground">
              Sign In
            </Button>
          </Link>
          <Link href="/login">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium shadow-sm shadow-primary/25">
              Get Started <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <div className="flex md:hidden">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 text-muted-foreground hover:text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            aria-label="Toggle Navigation"
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Dropdown Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b border-border bg-background/95 backdrop-blur-xl px-4 py-4 space-y-3">
          <Link
            href="/"
            onClick={() => setMobileMenuOpen(false)}
            className="block px-3 py-2 text-sm font-medium text-foreground/80 hover:text-foreground hover:bg-muted/50 rounded-lg"
          >
            Home
          </Link>
          <Link
            href="/pricing"
            onClick={() => setMobileMenuOpen(false)}
            className="block px-3 py-2 text-sm font-medium text-foreground/80 hover:text-foreground hover:bg-muted/50 rounded-lg"
          >
            Pricing
          </Link>
          <Link
            href="/privacy-policy"
            onClick={() => setMobileMenuOpen(false)}
            className={`block px-3 py-2 text-sm font-medium rounded-lg ${
              activePage === "privacy"
                ? "bg-primary/10 text-primary font-semibold"
                : "text-foreground/80 hover:text-foreground hover:bg-muted/50"
            }`}
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms-of-service"
            onClick={() => setMobileMenuOpen(false)}
            className={`block px-3 py-2 text-sm font-medium rounded-lg ${
              activePage === "terms"
                ? "bg-primary/10 text-primary font-semibold"
                : "text-foreground/80 hover:text-foreground hover:bg-muted/50"
            }`}
          >
            Terms of Service
          </Link>
          <div className="pt-2 flex flex-col gap-2">
            <Link href="/login" onClick={() => setMobileMenuOpen(false)} className="w-full">
              <Button variant="outline" className="w-full text-sm font-medium">
                Sign In
              </Button>
            </Link>
            <Link href="/login" onClick={() => setMobileMenuOpen(false)} className="w-full">
              <Button className="w-full bg-primary text-primary-foreground text-sm font-medium">
                Get Started <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

