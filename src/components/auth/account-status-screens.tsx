"use client";

import { useState } from "react";
import { Clock, ShieldAlert, Ban, RefreshCw, LogOut, CheckCircle2, MessageSquare, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface StatusScreenProps {
  email?: string | null;
  accountName?: string | null;
  reason?: string | null;
  onRefresh?: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

export function AccountPendingScreen({
  email,
  accountName,
  onRefresh,
  onSignOut,
}: StatusScreenProps) {
  const [checking, setChecking] = useState(false);

  const handleCheck = async () => {
    if (!onRefresh) return;
    setChecking(true);
    try {
      await onRefresh();
      toast.info("Status checked. Account is still pending authorization.");
    } catch {
      toast.error("Failed to re-check status. Please try again.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-xl border-border bg-card shadow-xl shadow-black/5">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500 ring-8 ring-amber-500/5">
            <Clock className="h-8 w-8 animate-pulse" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium px-3 py-1 text-xs">
              Account Awaiting Authorization
            </Badge>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
            Your Account is Pending Approval
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm mt-1 max-w-md mx-auto">
            Wattomation by OPSIYS requires explicit platform administrator authorization before granting access to the product workspace.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 pt-4">
          <div className="rounded-xl border border-border/80 bg-muted/40 p-4 text-xs space-y-2">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Account Email</span>
              <span className="font-semibold text-foreground">{email || "Authenticated User"}</span>
            </div>
            {accountName && (
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Workspace Name</span>
                <span className="font-semibold text-foreground">{accountName}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Authorization Status</span>
              <span className="inline-flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                Under Review
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What happens next?
            </h4>
            <div className="grid gap-2.5">
              <div className="flex items-start gap-3 rounded-lg border border-border/50 bg-card p-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                  1
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Administrator Verification</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    A platform administrator is reviewing your registration and setting up your workspace isolation.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-border/50 bg-card p-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                  2
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Activation & Notification</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Upon approval, your account is authorized to configure WhatsApp integrations and intelligent AI agents.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-border/50 bg-card p-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                  3
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Immediate Workspace Access</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    You can check your status anytime below or log back in once approved.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border pt-5">
          <Button
            type="button"
            variant="outline"
            onClick={onSignOut}
            className="w-full sm:w-auto text-muted-foreground hover:text-foreground"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>

          {onRefresh && (
            <Button
              type="button"
              onClick={handleCheck}
              disabled={checking}
              className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${checking ? "animate-spin" : ""}`} />
              Check Status
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

export function AccountRejectedScreen({
  email,
  reason,
  onSignOut,
}: StatusScreenProps) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-lg border-destructive/20 bg-card shadow-xl shadow-black/5">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive ring-8 ring-destructive/5">
            <ShieldAlert className="h-8 w-8" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive font-medium px-3 py-1 text-xs">
              Access Denied
            </Badge>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
            Account Registration Rejected
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm mt-1">
            Access to the Wattomation platform by OPSIYS could not be granted for this account.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs space-y-2">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Account Email</span>
              <span className="font-semibold text-foreground">{email || "Authenticated User"}</span>
            </div>
            {reason && (
              <div className="pt-2 border-t border-destructive/10">
                <span className="font-semibold text-destructive block mb-1">Reason provided:</span>
                <p className="text-muted-foreground leading-relaxed">{reason}</p>
              </div>
            )}
          </div>
          <p className="text-xs text-center text-muted-foreground">
            If you believe this is in error, please contact the platform administrator directly.
          </p>
        </CardContent>

        <CardFooter className="flex justify-center border-t border-border pt-5">
          <Button
            type="button"
            variant="outline"
            onClick={onSignOut}
            className="w-full text-muted-foreground hover:text-foreground"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export function AccountSuspendedScreen({
  email,
  reason,
  onSignOut,
}: StatusScreenProps) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-lg border-border bg-card shadow-xl shadow-black/5">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground ring-8 ring-muted/50">
            <Ban className="h-8 w-8 text-amber-500" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-500 font-medium px-3 py-1 text-xs">
              Access Suspended
            </Badge>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
            Account Access Unavailable
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm mt-1">
            Access to this Wattomation workspace by OPSIYS has been revoked or temporarily suspended by the platform administrator.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          <div className="rounded-xl border border-border bg-muted/40 p-4 text-xs space-y-2">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Account Email</span>
              <span className="font-semibold text-foreground">{email || "Authenticated User"}</span>
            </div>
            {reason && (
              <div className="pt-2 border-t border-border">
                <span className="font-semibold text-foreground block mb-1">Notice:</span>
                <p className="text-muted-foreground leading-relaxed">{reason}</p>
              </div>
            )}
          </div>
          <p className="text-xs text-center text-muted-foreground">
            To restore access or reactivate your workspace, reach out to your platform administrator.
          </p>
        </CardContent>

        <CardFooter className="flex justify-center border-t border-border pt-5">
          <Button
            type="button"
            variant="outline"
            onClick={onSignOut}
            className="w-full text-muted-foreground hover:text-foreground"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
