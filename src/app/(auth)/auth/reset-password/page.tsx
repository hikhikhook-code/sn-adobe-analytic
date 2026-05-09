import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl">Reset password</CardTitle>
        <CardDescription>Choose a new password. (Stub — Phase 1.)</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input id="password" type="password" required minLength={8} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm new password</Label>
            <Input id="confirm" type="password" required minLength={8} />
          </div>
          <Button type="submit" className="w-full" disabled>
            Reset password (coming soon)
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/auth/login" className="font-medium text-accent-blue hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
