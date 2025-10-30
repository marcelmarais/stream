"use client";

import { CalendarBlankIcon } from "@phosphor-icons/react";
import type { Footer as FooterComponent } from "@/components/footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface CalendarViewProps {
  folderPath: string;
  footerComponent: React.ReactElement<typeof FooterComponent>;
}

export function CalendarView({
  folderPath: _folderPath,
  footerComponent: _footerComponent,
}: CalendarViewProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 p-6">
        <div className="mx-auto flex h-full max-w-4xl flex-col items-center justify-center gap-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <CalendarBlankIcon
              className="h-8 w-8 text-muted-foreground"
              weight="duotone"
            />
          </div>

          <div className="text-center">
            <h2 className="mb-2 font-semibold text-2xl text-foreground">
              Calendar View
            </h2>
            <p className="text-muted-foreground text-sm">
              This view is coming soon
            </p>
          </div>

          <div className="grid w-full max-w-2xl grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Feature 1</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  Placeholder for upcoming calendar feature
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Feature 2</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  Placeholder for upcoming calendar feature
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
