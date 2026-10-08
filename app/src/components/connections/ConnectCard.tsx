import { useState } from "react";
import type { ReactNode } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { toast } from "@/components/base/toast/toast";
import { type ConnectionId, useConnection } from "@/lib/tenantConfig";
import { Card, Note } from "@/components/settings/ui";

/**
 * One service with a Connect button. Connecting is a placeholder (see
 * lib/tenantConfig.ts): it records the request and the non-secret detail.
 */
export function ConnectCard({
  id,
  title,
  description,
  detailLabel,
  detailPlaceholder,
  children,
}: {
  id: ConnectionId;
  title: string;
  description: ReactNode;
  /** Ask for one non-secret detail first (a workspace, a feed URL). */
  detailLabel?: string;
  detailPlaceholder?: string;
  children?: ReactNode;
}) {
  const conn = useConnection(id);
  const [detail, setDetail] = useState(conn.detail);
  const requested = conn.status === "requested";

  return (
    <Card
      title={title}
      description={description}
      action={requested ? <Badge size="sm" color="warning">Requested</Badge> : <Badge size="sm" color="gray">Not connected</Badge>}
    >
      <div className="space-y-3">
        {children}
        {detailLabel && (
          <Input size="sm" label={detailLabel} placeholder={detailPlaceholder} value={detail} onChange={setDetail} isDisabled={requested} />
        )}
        {requested ? (
          <>
            <Note>We have your request. This connection turns on when its server side ships; nothing was sent to {title} and no credentials were stored.</Note>
            <Button size="sm" color="secondary" onClick={conn.clear}>Cancel request</Button>
          </>
        ) : (
          <Button
            size="sm"
            isDisabled={!!detailLabel && !detail.trim()}
            onClick={() => {
              conn.request(detail.trim());
              toast.add({ type: "success", title: `${title} requested` });
            }}
          >
            Connect
          </Button>
        )}
      </div>
    </Card>
  );
}
