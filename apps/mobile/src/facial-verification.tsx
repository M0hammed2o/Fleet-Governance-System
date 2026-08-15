import { useEffect, useState } from "react";
import { Camera } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import type {
  MobileBiometricScenario,
  MobileBootstrapResponse,
  MobileFacialIdentityContext,
  MobileManualFallbackSummary,
} from "@genbridge/shared-types";
import { SYNTHETIC_BIOMETRIC_DISCLOSURE } from "@genbridge/shared-types";
import { AppText, Banner, Button, Card, EmptyState, StatusBadge } from "@genbridge/mobile-ui";
import { useAuth } from "./auth-context";

const SCENARIOS: Array<{ value: MobileBiometricScenario; label: string }> = [
  { value: "SUCCESS", label: "Verified result" },
  { value: "NON_MATCH", label: "Non-match result" },
  { value: "LIVENESS_FAILURE", label: "Facial-liveness failure" },
  { value: "INDETERMINATE", label: "Indeterminate result" },
  { value: "PROVIDER_OUTAGE", label: "Provider-unavailable result" },
  { value: "RATE_LIMITING", label: "Provider rate-limit result" },
];

function resultPresentation(result: MobileFacialIdentityContext["latestAttempt"]) {
  if (!result) return null;
  switch (result.result) {
    case "MATCH":
      return { title: "Verified result", message: "The synthetic one-to-one test matched the enrolled test template.", tone: "info" as const };
    case "NO_MATCH":
      return { title: "Non-match result", message: "Do not clear identity. Retry only when appropriate or request manual fallback.", tone: "danger" as const };
    case "LIVENESS_FAILED":
      return { title: "Facial-liveness failure", message: "The synthetic liveness challenge failed. No identity match was accepted.", tone: "danger" as const };
    case "PROVIDER_UNAVAILABLE":
      return {
        title: result.safeErrorCode === "RATE_LIMITED" ? "Rate limit feedback" : "Provider unavailable",
        message: result.safeErrorCode === "RATE_LIMITED"
          ? "The synthetic provider reported a rate limit. Wait before retrying or request manual fallback."
          : "The synthetic provider is unavailable. No identity decision was made; use controlled manual fallback.",
        tone: "danger" as const,
      };
    case "NOT_ENROLLED":
      return { title: "Driver not enrolled", message: "No active test template exists. Synthetic verification cannot proceed; use manual fallback.", tone: "danger" as const };
    default:
      return { title: "Indeterminate result", message: "The synthetic test could not reach a decision. Identity remains pending.", tone: "danger" as const };
  }
}

export function SyntheticFacialVerificationOutcome({
  identity,
}: {
  identity: MobileFacialIdentityContext;
}) {
  const result = resultPresentation(identity.latestAttempt);
  return (
    <div className="list" aria-label="Synthetic facial-verification outcome">
      <Banner
        tone="danger"
        title="Synthetic biometric warning"
        message={SYNTHETIC_BIOMETRIC_DISCLOSURE}
      />
      {result ? (
        <Banner tone={result.tone} title={result.title} message={result.message} />
      ) : null}
      {identity.auditConfirmation ? (
        <Banner
          tone="info"
          title="Audit confirmation"
          message={`Server audit recorded ${identity.auditConfirmation.action} at ${new Date(identity.auditConfirmation.recordedAt).toLocaleString()}.`}
        />
      ) : null}
    </div>
  );
}

export function SyntheticFacialVerificationPanel({
  eventId,
  identity,
  online,
  busy,
  onAction,
}: {
  eventId: string;
  identity: MobileFacialIdentityContext;
  online: boolean;
  busy: boolean;
  onAction: (body: unknown, message: string) => Promise<void>;
}) {
  const [scenario, setScenario] = useState<MobileBiometricScenario>("SUCCESS");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("Camera readiness has not been checked.");
  const [fallbackReason, setFallbackReason] = useState("");
  const result = resultPresentation(identity.latestAttempt);

  async function checkCamera() {
    setCameraReady(false);
    try {
      const current = await Camera.checkPermissions();
      let state = current.camera;
      if (Capacitor.isNativePlatform() && state !== "granted") {
        state = (await Camera.requestPermissions({ permissions: ["camera"] })).camera;
      }
      if (state === "denied") {
        setCameraMessage("Camera permission denied. Enable Camera in Android Settings before running the rehearsal.");
        return;
      }
      setCameraReady(true);
      setCameraMessage("Camera interface ready. No photo, video, face image or biometric data will be captured or stored.");
    } catch {
      if (!Capacitor.isNativePlatform()) {
        setCameraReady(true);
        setCameraMessage("Browser test shell detected. Synthetic capture surface ready; no camera or image data is used.");
      } else {
        setCameraMessage("Camera permission could not be confirmed. Check Android Settings and retry.");
      }
    }
  }

  const fallback = identity.fallback;
  return (
    <div className="list" aria-label="Synthetic facial verification">
      <Banner tone="danger" title="Synthetic biometric warning" message={SYNTHETIC_BIOMETRIC_DISCLOSURE} />
      <Card>
        <div className="row-between">
          <AppText variant="heading">Driver enrolment status</AppText>
          <StatusBadge
            tone={identity.enrolment.status === "ENROLLED" ? "success" : "danger"}
            label={identity.enrolment.status.replaceAll("_", " ")}
          />
        </div>
        <AppText variant="caption">
          {identity.enrolment.status === "ENROLLED"
            ? `Active synthetic-capable test template version ${identity.enrolment.version}.`
            : "No active facial-verification template is available for this driver."}
        </AppText>
      </Card>
      <Card>
        <AppText variant="heading">Synthetic camera and capture rehearsal</AppText>
        <AppText>
          This checks camera permission and displays a test capture interface only. It never takes a photo or processes a face.
        </AppText>
        <Button
          tone="secondary"
          label="Check camera permission — no image captured"
          disabled={!online || busy}
          onClick={() => void checkCamera()}
        />
        <div className={`synthetic-capture ${cameraReady ? "ready" : ""}`} role="img" aria-label="Synthetic face capture alignment guide">
          <span aria-hidden="true">◎</span>
          <strong>{cameraReady ? "Synthetic capture surface ready" : "Camera readiness required"}</strong>
          <small>No real face or biometric data enters this interface.</small>
        </div>
        <div aria-live="polite"><AppText variant="caption">{cameraMessage}</AppText></div>
        <label className="field">
          Test outcome
          <select value={scenario} onChange={(event) => setScenario(event.currentTarget.value as MobileBiometricScenario)}>
            {SCENARIOS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <Button
          label="Initiate synthetic facial-verification test"
          disabled={!online || busy || !cameraReady || identity.attemptsRemaining === 0 || identity.enrolment.status !== "ENROLLED"}
          busy={busy}
          onClick={() => void onAction(
            { action: "SYNTHETIC_IDENTITY_VERIFY", scenario },
            "Synthetic facial-verification result and audit event recorded.",
          )}
        />
        <AppText variant="caption">
          {identity.attemptsRemaining} of {identity.rateLimit.maximum} attempts remain in the rolling {identity.rateLimit.windowMinutes}-minute window.
        </AppText>
        {!online ? <Banner tone="danger" title="Disconnected" message="Verification and fallback controls are disabled. Nothing will be queued or recorded offline." /> : null}
      </Card>
      {result ? <Banner tone={result.tone} title={result.title} message={result.message} /> : null}
      {identity.auditConfirmation ? (
        <Banner
          tone="info"
          title="Audit confirmation"
          message={`Server audit recorded ${identity.auditConfirmation.action} at ${new Date(identity.auditConfirmation.recordedAt).toLocaleString()}.`}
        />
      ) : null}
      <Card>
        <AppText variant="heading">Manual identity fallback</AppText>
        <AppText>
          A reason is mandatory. A different authorized manager must approve before the officer can apply the fallback; approval never clears the gate automatically.
        </AppText>
        {fallback ? (
          <>
            <StatusBadge
              tone={fallback.status === "APPROVED" ? "success" : fallback.status === "DENIED" ? "danger" : "warning"}
              label={`Fallback ${fallback.status}`}
            />
            <AppText>{fallback.reason}</AppText>
            {fallback.status === "PENDING" ? (
              <AppText variant="caption">Waiting for manager approval. Separation of duties is enforced by the server.</AppText>
            ) : null}
            {fallback.status === "APPROVED" ? (
              <Button
                label="Apply approved manual identity fallback"
                disabled={!online || busy}
                busy={busy}
                onClick={() => void onAction(
                  { action: "APPLY_APPROVED_FALLBACK", manualFallbackId: fallback.id },
                  "Approved manual identity fallback applied and audited.",
                )}
              />
            ) : null}
            {fallback.status === "DENIED" ? (
              <Banner tone="danger" title="Fallback denied" message="Identity remains pending. A denial is not an override and cannot be applied." />
            ) : null}
          </>
        ) : (
          <>
            <label className="field">
              Mandatory fallback reason
              <textarea
                value={fallbackReason}
                maxLength={1000}
                rows={4}
                aria-describedby={`fallback-help-${eventId}`}
                onChange={(event) => setFallbackReason(event.currentTarget.value)}
              />
            </label>
            <small id={`fallback-help-${eventId}`}>Enter at least 10 characters. Do not include biometric data.</small>
            <Button
              tone="secondary"
              label="Request manager approval"
              disabled={!online || busy || fallbackReason.trim().length < 10}
              busy={busy}
              onClick={() => void onAction(
                { action: "REQUEST_MANUAL_FALLBACK", reason: fallbackReason },
                "Manual fallback requested; manager approval is required.",
              )}
            />
          </>
        )}
      </Card>
    </div>
  );
}

export function ManualFallbackApprovals({ bootstrap }: { bootstrap: MobileBootstrapResponse }) {
  const { client, online } = useAuth();
  const [fallbacks, setFallbacks] = useState<MobileManualFallbackSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const canApprove = bootstrap.principal.permissions.includes("facialVerificationFallback:APPROVE");
  const canReject = bootstrap.principal.permissions.includes("facialVerificationFallback:REJECT");

  async function refresh() {
    try {
      setFallbacks((await client.facialFallbacks()).fallbacks);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Fallback approvals unavailable.");
    }
  }
  useEffect(() => {
    void client
      .facialFallbacks()
      .then((value) => setFallbacks(value.fallbacks))
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Fallback approvals unavailable.",
        ),
      );
  }, [client]);
  async function decide(id: string, decision: "APPROVED" | "DENIED") {
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      await client.decideFacialFallback(id, decision);
      setMessage(`Fallback ${decision.toLowerCase()} and audit event recorded.`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Decision was not recorded.");
    } finally {
      setBusyId(null);
    }
  }
  return (
    <Card>
      <AppText variant="heading">Manual identity fallback approvals</AppText>
      <Banner tone="danger" title="Synthetic biometric warning" message={SYNTHETIC_BIOMETRIC_DISCLOSURE} />
      <AppText variant="caption">Approval records authorization only. The requesting officer must separately apply it to the matching driver and gate event.</AppText>
      {message ? <Banner tone="info" title="Server confirmed" message={message} /> : null}
      {error ? <Banner tone="danger" title="Decision not recorded" message={error} /> : null}
      {fallbacks === null ? <AppText>Loading approval requests…</AppText> : null}
      {fallbacks?.length === 0 ? <EmptyState title="No pending fallbacks" message="Pending identity fallback requests will appear here." /> : null}
      {fallbacks?.map((fallback) => (
        <div className="approval-request" key={fallback.id}>
          <strong>{fallback.driver.name}</strong>
          <span>Requested by {fallback.requestedBy.name}</span>
          <AppText>{fallback.reason}</AppText>
          {fallback.selfApprovalBlocked ? (
            <Banner tone="danger" title="Separation of duties" message="You requested this fallback and cannot approve or deny it yourself." />
          ) : null}
          <div className="button-row">
            <Button label="Approve fallback" disabled={!online || !canApprove || fallback.selfApprovalBlocked} busy={busyId === fallback.id} onClick={() => void decide(fallback.id, "APPROVED")} />
            <Button tone="danger" label="Deny fallback" disabled={!online || !canReject || fallback.selfApprovalBlocked} busy={busyId === fallback.id} onClick={() => void decide(fallback.id, "DENIED")} />
          </div>
        </div>
      ))}
    </Card>
  );
}
