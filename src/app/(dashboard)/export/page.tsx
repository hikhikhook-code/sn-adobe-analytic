import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { FileDown } from "lucide-react";

export default function ExportPage() {
  return (
    <>
      <TopBar title="Export" subtitle="CSV exports of your search results" />
      <div className="p-6">
        <PageHeader
          title="Export history"
          description="Past CSV exports will appear here. Use the Export button on any search result page."
        />
        <Card>
          <CardHeader>
            <CardTitle>How it works</CardTitle>
            <CardDescription>Export Adobe Stock results to CSV in one click</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p className="mb-3">CSV columns:</p>
            <ul className="list-inside list-disc space-y-1">
              <li>ID, Title, Downloads, Performance Score, Downloads/Month</li>
              <li>Content Type, Categories, Upload Date, Contributor</li>
              <li>Keywords, Adobe Stock URL, Is Premium, Is AI</li>
            </ul>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-4">
              <FileDown className="h-5 w-5 text-muted-foreground" />
              <p className="text-xs">
                Export history table is part of the Phase 2 polish — every export
                is already logged to <code>ExportHistory</code> in the database.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
