import { useEffect, useState, type FormEvent } from "react";
import type {
  GateQueueItem,
  MobileBootstrapResponse,
  MobileNotification,
  MobileMovementDetail,
  OwnerOverview,
  Page,
} from "@genbridge/shared-types";
import type { MobileGateEvent } from "@genbridge/api-client";
import {
  AppText,
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingState,
  Screen,
  StatusBadge,
} from "@genbridge/mobile-ui";
import { AuthProvider, useAuth } from "./auth-context";
import { allowedAreas, authorizeDeepLink } from "./navigation-policy";
import { navigate, useRoute } from "./router";
import { resolveMobileRuntimeConfig } from "./config";
import { validateEvidenceFile } from "./evidence";
import { getSelectedGateId, setSelectedGateId } from "./gate-assignment";
import "./styles.css";

// Gate assignment is intentionally memory-only; the compatibility-shaped
// setter keeps route code compact without writing tenant identifiers to web storage.
const sessionStorage = {
  setItem: (_key: string, value: string) => setSelectedGateId(value),
};

function Shell() {
  const auth = useAuth();
  const route = useRoute();
  useEffect(() => {
    if (!auth.loading && !auth.bootstrap && route !== "login")
      navigate("login", true);
    if (auth.bootstrap && route === "login") navigate("home", true);
  }, [auth.bootstrap, auth.loading, route]);
  if (auth.loading)
    return (
      <Screen>
        <LoadingState label="Checking secure session" />
      </Screen>
    );
  if (!auth.bootstrap) return <Login />;
  if (!authorizeDeepLink(route, auth.bootstrap))
    return (
      <Screen>
        <Banner
          tone="danger"
          title="Access denied"
          message="Your current server permissions do not allow this destination."
        />
        <Button label="Return home" onClick={() => navigate("home")} />
      </Screen>
    );
  return (
    <div className="app-shell">
      <Connectivity />
      <Header bootstrap={auth.bootstrap} />
      <div className="content">{renderRoute(route, auth.bootstrap)}</div>
      <Navigation bootstrap={auth.bootstrap} route={route} />
    </div>
  );
}

function renderRoute(route: string, bootstrap: MobileBootstrapResponse) {
  if (route === "home") return <Home bootstrap={bootstrap} />;
  if (route === "guard") return <GuardHome bootstrap={bootstrap} />;
  if (route.startsWith("guard/movements/"))
    return (
      <MovementWorkflow
        id={decodeURIComponent(route.split("/")[2] ?? "")}
        bootstrap={bootstrap}
      />
    );
  if (route.startsWith("guard/events/"))
    return (
      <GateEventWorkflow
        id={decodeURIComponent(route.split("/")[2] ?? "")}
        bootstrap={bootstrap}
      />
    );
  if (route === "owner") return <OwnerHome />;
  if (route.startsWith("owner/movements/"))
    return (
      <OwnerMovement
        id={decodeURIComponent(route.split("/")[2] ?? "")}
        bootstrap={bootstrap}
      />
    );
  if (route === "notifications") return <Notifications />;
  if (route === "profile") return <Profile bootstrap={bootstrap} />;
  return (
    <Screen>
      <EmptyState
        title="Page unavailable"
        message="This destination is not part of the mobile priority workflows."
      />
      <Button label="Return home" onClick={() => navigate("home")} />
    </Screen>
  );
}

function Connectivity() {
  const { online } = useAuth();
  return online ? null : (
    <div className="persistent-warning" role="alert">
      Disconnected — critical actions are disabled and nothing is recorded until
      the server confirms it.
    </div>
  );
}
function Header({ bootstrap }: { bootstrap: MobileBootstrapResponse }) {
  return (
    <header className="app-header">
      <div>
        <strong>Genbridge Fleet Governance</strong>
        <span>{bootstrap.principal.tenant.name}</span>
      </div>
      {bootstrap.environment.syntheticOnly ? (
        <StatusBadge tone="synthetic" label="Synthetic" />
      ) : null}
    </header>
  );
}
function Navigation({
  bootstrap,
  route,
}: {
  bootstrap: MobileBootstrapResponse;
  route: string;
}) {
  const areas = allowedAreas(bootstrap);
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {areas.map((area) => (
        <button
          key={area}
          aria-current={route.startsWith(area) ? "page" : undefined}
          onClick={() => navigate(area)}
        >
          {area === "guard"
            ? "Gate"
            : area === "owner"
              ? "Overview"
              : area[0].toUpperCase() + area.slice(1)}
        </button>
      ))}
    </nav>
  );
}

function Login() {
  const { signIn, error, loading } = useAuth();
  const runtime = resolveMobileRuntimeConfig();
  const [tenantSlug, setTenantSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!tenantSlug.trim() || !email.trim() || !password) return;
    try {
      await signIn({ tenantSlug, email, password });
      navigate("home", true);
    } catch {
      /* generic server error shown */
    }
  }
  return (
    <Screen>
      <div className="login-wrap">
        <AppText variant="title">Fleet Governance</AppText>
        <AppText>Secure gate operations and executive oversight.</AppText>
        {runtime.syntheticDevelopment ? (
          <StatusBadge
            tone="synthetic"
            label="Local synthetic authentication"
          />
        ) : null}
        {error ? (
          <Banner tone="danger" title="Sign-in unsuccessful" message={error} />
        ) : null}
        <form
          className="card form-stack"
          onSubmit={(event) => void submit(event)}
        >
          <Field
            label="Company"
            value={tenantSlug}
            onChange={(e) => setTenantSlug(e.currentTarget.value)}
            autoCapitalize="none"
            autoComplete="organization"
          />
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            autoComplete="email"
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            autoComplete="current-password"
          />
          <Button
            type="submit"
            label="Sign in"
            busy={loading}
            disabled={!tenantSlug.trim() || !email.trim() || !password}
          />
        </form>
        <AppText variant="caption">
          Production native authentication remains disabled until approved
          configuration exists. Errors do not disclose whether an account
          exists.
        </AppText>
      </div>
    </Screen>
  );
}

function Home({ bootstrap }: { bootstrap: MobileBootstrapResponse }) {
  return (
    <Screen>
      <AppText variant="title">Hello, {bootstrap.principal.name}</AppText>
      <AppText>{bootstrap.principal.roleName}</AppText>
      {bootstrap.sites.length === 0 && bootstrap.capabilities.guard ? (
        <Banner
          title="No gate assignment available"
          message="Ask an authorized administrator to configure an active site and gate."
        />
      ) : null}
      <div className="tile-grid">
        {bootstrap.capabilities.guard ? (
          <Card>
            <AppText variant="heading">Gate operations</AppText>
            <AppText>
              Queue, inspection, evidence, decisions, return and reconciliation.
            </AppText>
            <Button label="Open gate queue" onClick={() => navigate("guard")} />
          </Card>
        ) : null}
        {bootstrap.capabilities.ownerOverview ? (
          <Card>
            <AppText variant="heading">Executive overview</AppText>
            <AppText>
              Fleet status, exceptions, indicators, tracker health and
              authorized approvals.
            </AppText>
            <Button label="Open overview" onClick={() => navigate("owner")} />
          </Card>
        ) : null}
        <Card>
          <AppText variant="heading">Notifications</AppText>
          <AppText>
            Permission-filtered operational notices. Push delivery is disabled.
          </AppText>
          <Button
            tone="secondary"
            label="Open notifications"
            onClick={() => navigate("notifications")}
          />
        </Card>
      </div>
    </Screen>
  );
}

function GuardHome({ bootstrap }: { bootstrap: MobileBootstrapResponse }) {
  const { client } = useAuth();
  const [siteId, setSiteId] = useState(bootstrap.sites[0]?.id ?? "");
  const site = bootstrap.sites.find((item) => item.id === siteId);
  const [gateId, setGateId] = useState(site?.gates[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Page<GateQueueItem> | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    setError(null);
    try {
      setResult(await client.gateQueue(query));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Gate queue failed.");
    }
  }
  useEffect(() => {
    void client
      .gateQueue("")
      .then(setResult)
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : "Gate queue failed.",
        ),
      );
  }, [client]);
  return (
    <Screen>
      <AppText variant="title">Gate queue</AppText>
      <Card accessibilityLabel="Current site and gate assignment">
        <label className="field">
          <span>Site</span>
          <select
            value={siteId}
            onChange={(e) => {
              const nextSiteId = e.currentTarget.value;
              setSiteId(nextSiteId);
              setGateId(
                bootstrap.sites.find((item) => item.id === nextSiteId)?.gates[0]
                  ?.id ?? "",
              );
            }}
          >
            {bootstrap.sites.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Gate</span>
          <select
            value={gateId}
            onChange={(e) => setGateId(e.currentTarget.value)}
          >
            {site?.gates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.direction})
              </option>
            ))}
          </select>
        </label>
      </Card>
      <form
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <Field
          label="Registration, fleet or reference"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <Button type="submit" label="Search" />
      </form>
      {error ? (
        <Banner tone="danger" title="Queue unavailable" message={error} />
      ) : null}
      {!result ? (
        <LoadingState label="Loading gate queue" />
      ) : result.items.length === 0 ? (
        <EmptyState
          title="No vehicles awaiting action"
          message="Refresh or search an approved identifier."
        />
      ) : (
        <div className="list">
          {result.items.map((item) => (
            <Card key={item.id}>
              <div className="row-between">
                <AppText variant="heading">
                  {item.vehicle.registrationNumber}
                </AppText>
                <StatusBadge
                  tone={item.authorization.allowed ? "success" : "danger"}
                  label={item.authorization.allowed ? "Authorized" : "Blocked"}
                />
              </div>
              <AppText>
                {item.referenceCode} · {item.driver.name}
              </AppText>
              <AppText variant="caption">
                {item.direction === "ENTRY" ? "Departure" : "Return"} ·{" "}
                {item.site.name}
              </AppText>
              <Tracker tracker={item.tracker} />
              <Button
                label="Open movement"
                disabled={!gateId}
                onClick={() => {
                  sessionStorage.setItem("currentGateId", gateId);
                  navigate(`guard/movements/${encodeURIComponent(item.id)}`);
                }}
              />
            </Card>
          ))}
        </div>
      )}
    </Screen>
  );
}

function Tracker({ tracker }: { tracker: GateQueueItem["tracker"] }) {
  return (
    <div className="tracker">
      <StatusBadge
        tone={
          tracker.isSynthetic
            ? "synthetic"
            : tracker.freshness === "FRESH"
              ? "success"
              : "warning"
        }
        label={`${tracker.freshness}${tracker.isSynthetic ? " · synthetic" : ""}`}
      />
      {tracker.recordedAt ? (
        <AppText variant="caption">
          Recorded {new Date(tracker.recordedAt).toLocaleString()}
        </AppText>
      ) : null}
      {tracker.limitations.map((item) => (
        <AppText key={item} variant="caption">
          {item}
        </AppText>
      ))}
    </div>
  );
}

function MovementWorkflow({
  id,
  bootstrap,
}: {
  id: string;
  bootstrap: MobileBootstrapResponse;
}) {
  const { client, online } = useAuth();
  const [payload, setPayload] = useState<{
    movement: MobileMovementDetail;
    tracker: GateQueueItem["tracker"];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vehicleConfirmed, setVehicleConfirmed] = useState(false);
  const [driverConfirmed, setDriverConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const gateId = getSelectedGateId();
  useEffect(() => {
    void client
      .movement(id)
      .then(setPayload)
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : "Movement unavailable.",
        ),
      );
  }, [client, id]);
  if (error)
    return (
      <Screen>
        <Banner tone="danger" title="Movement unavailable" message={error} />
      </Screen>
    );
  if (!payload)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  const movement = payload.movement;
  const direction = movement.status === "APPROVED" ? "ENTRY" : "EXIT";
  async function start() {
    setBusy(true);
    setError(null);
    try {
      const response = await client.startGateEvent({
        movementAuthorisationId: id,
        gateId,
        direction,
      });
      navigate(`guard/events/${response.gateEvent.id}`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Gate event did not start.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <AppText variant="title">Confirm movement</AppText>
      {error ? (
        <Banner tone="danger" title="Not recorded" message={error} />
      ) : null}
      <Card>
        <AppText variant="heading">{movement.referenceCode}</AppText>
        <StatusBadge
          tone={
            movement.status === "APPROVED" || movement.status === "IN_PROGRESS"
              ? "success"
              : "danger"
          }
          label={movement.status}
        />
        <AppText>{movement.purpose || "No purpose recorded"}</AppText>
        <AppText variant="caption">
          {movement.destination || "No destination recorded"}
        </AppText>
      </Card>
      <Card>
        <AppText variant="heading">Vehicle</AppText>
        <AppText>
          {movement.vehicle.registrationNumber} ·{" "}
          {movement.vehicle.fleetNumber || "No fleet number"}
        </AppText>
        <label className="check">
          <input
            type="checkbox"
            checked={vehicleConfirmed}
            onChange={(e) => setVehicleConfirmed(e.currentTarget.checked)}
          />{" "}
          I confirmed the displayed vehicle
        </label>
        <AppText variant="heading">Driver</AppText>
        <AppText>
          {movement.driver.name} ·{" "}
          {movement.driver.employeeNumber || "No employee number"}
        </AppText>
        <label className="check">
          <input
            type="checkbox"
            checked={driverConfirmed}
            onChange={(e) => setDriverConfirmed(e.currentTarget.checked)}
          />{" "}
          I confirmed the displayed driver
        </label>
      </Card>
      <Tracker tracker={payload.tracker} />
      <Button
        label={`Start ${direction === "ENTRY" ? "departure" : "return"} checks`}
        busy={busy}
        disabled={!online || !gateId || !vehicleConfirmed || !driverConfirmed}
        onClick={() => void start()}
      />
      {!gateId ? (
        <Banner
          title="Gate required"
          message="Return to the queue and select an active gate."
        />
      ) : null}
      {bootstrap.environment.syntheticOnly ? (
        <StatusBadge tone="synthetic" label="Synthetic pilot records only" />
      ) : null}
    </Screen>
  );
}

function GateEventWorkflow({
  id,
  bootstrap,
}: {
  id: string;
  bootstrap: MobileBootstrapResponse;
}) {
  const { client, online } = useAuth();
  const [event, setEvent] = useState<MobileGateEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      setEvent((await client.gateEvent(id)).gateEvent);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Gate event unavailable.",
      );
    }
  }
  useEffect(() => {
    void client
      .gateEvent(id)
      .then((value) => setEvent(value.gateEvent))
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : "Gate event unavailable.",
        ),
      );
  }, [client, id]);
  async function act(body: unknown, message: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await client.gateAction(id, body);
      setSuccess(message);
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The action was not recorded.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!event)
    return (
      <Screen>
        {error ? (
          <Banner tone="danger" title="Event unavailable" message={error} />
        ) : (
          <LoadingState />
        )}
      </Screen>
    );
  return (
    <Screen>
      <AppText variant="title">Gate event</AppText>
      {success ? (
        <Banner tone="info" title="Server confirmed" message={success} />
      ) : null}
      {error ? (
        <Banner tone="danger" title="Not recorded" message={error} />
      ) : null}
      <Card>
        <AppText variant="heading">{event.vehicle.registrationNumber}</AppText>
        <AppText>{event.driver.name}</AppText>
        <AppText>
          {event.site.name} · {event.gate.name}
        </AppText>
        <StatusBadge
          tone={
            event.status === "DENIED"
              ? "danger"
              : event.status === "COMPLETED"
                ? "success"
                : "info"
          }
          label={event.status.replaceAll("_", " ")}
        />
      </Card>
      {event.status === "INSPECTION_STARTED" ? (
        <>
          <Button
            label="Confirm identity step"
            disabled={!online}
            busy={busy}
            onClick={() =>
              void act(
                { action: "IDENTITY_PENDING" },
                "Identity confirmation started.",
              )
            }
          />
        </>
      ) : null}
      {event.status === "IDENTITY_PENDING" &&
      bootstrap.environment.syntheticOnly ? (
        <Button
          label="Run synthetic identity verification"
          disabled={!online}
          busy={busy}
          onClick={() =>
            void act(
              {
                action: "SYNTHETIC_IDENTITY_VERIFY",
                capturedImageRef: `synthetic:mobile-${id}`,
              },
              "Synthetic identity verification confirmed by the server.",
            )
          }
        />
      ) : null}
      {event.status === "IDENTITY_VERIFIED" ? (
        <Button
          label="Begin vehicle checks"
          disabled={!online}
          busy={busy}
          onClick={() =>
            void act({ action: "BEGIN_CHECKS" }, "Vehicle checks started.")
          }
        />
      ) : null}
      {event.status === "VEHICLE_CHECKS_IN_PROGRESS" ? (
        <Inspection event={event} busy={busy} onAction={act} />
      ) : null}
      {event.status === "EXCEPTION_RAISED" ? (
        <Button
          label="Request supervisor review"
          disabled={!online}
          busy={busy}
          onClick={() =>
            void act({ action: "ESCALATE" }, "Supervisor review requested.")
          }
        />
      ) : null}
      {["VEHICLE_CHECKS_IN_PROGRESS", "SUPERVISOR_REVIEW"].includes(
        event.status,
      ) ? (
        <Card>
          <Field
            label="Decision or override reason"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          <div className="button-row">
            <Button
              label="Clear movement"
              disabled={!online}
              busy={busy}
              onClick={() =>
                void act(
                  { action: "CLEAR", reason },
                  "Movement clearance recorded.",
                )
              }
            />
            <Button
              tone="danger"
              label="Block movement"
              disabled={!online || !reason.trim()}
              busy={busy}
              onClick={() =>
                void act(
                  { action: "DENY", reason },
                  "Movement blocked with the recorded reason.",
                )
              }
            />
          </div>
        </Card>
      ) : null}
      {["CLEARED", "DENIED"].includes(event.status) ? (
        <Button
          label="Record final gate outcome"
          disabled={!online}
          busy={busy}
          onClick={() =>
            void act(
              { action: "COMPLETE" },
              "Gate outcome completed and audit chronology updated.",
            )
          }
        />
      ) : null}
      {event.status === "COMPLETED" ? (
        <Banner
          tone="info"
          title="Gate workflow complete"
          message="The server recorded the final outcome. Return reconciliation is created automatically when both cleared legs are available."
        />
      ) : null}
      <EvidenceCapture eventId={id} />
    </Screen>
  );
}

function Inspection({
  event,
  busy,
  onAction,
}: {
  event: MobileGateEvent;
  busy: boolean;
  onAction: (body: unknown, message: string) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  if (!event.inspectionTemplate)
    return (
      <Banner
        title="Checklist unavailable"
        message="An authorized administrator must configure an active checklist before clearance."
      />
    );
  return (
    <div className="list">
      <AppText variant="heading">Required checklist</AppText>
      {event.inspectionTemplate.items.map((item) => {
        const recorded = event.inspectionResults.find(
          (result) => result.inspectionItemId === item.id,
        );
        return (
          <Card key={item.id}>
            <AppText variant="heading">{item.label}</AppText>
            {item.description ? (
              <AppText variant="caption">{item.description}</AppText>
            ) : null}
            {recorded ? (
              <StatusBadge
                tone={recorded.outcome === "PASS" ? "success" : "danger"}
                label={recorded.outcome}
              />
            ) : null}
            {item.responseType !== "CHECK" ? (
              <Field
                label={`${item.label} ${item.unit ? `(${item.unit})` : "value"}`}
                value={values[item.id] ?? ""}
                onChange={(e) =>
                  setValues((current) => ({
                    ...current,
                    [item.id]: e.currentTarget.value,
                  }))
                }
                inputMode={item.responseType === "READING" ? "decimal" : "text"}
              />
            ) : null}
            <div className="button-row">
              <Button
                label="Pass"
                busy={busy}
                onClick={() =>
                  void onAction(
                    {
                      action: "RECORD_INSPECTION",
                      input: {
                        inspectionItemId: item.id,
                        outcome: "PASS",
                        readingValue: values[item.id],
                        readingUnit: item.unit ?? undefined,
                      },
                    },
                    `${item.label} passed.`,
                  )
                }
              />
              <Button
                tone="danger"
                label="Fail and raise exception"
                busy={busy}
                onClick={() =>
                  void onAction(
                    {
                      action: "RECORD_INSPECTION",
                      input: {
                        inspectionItemId: item.id,
                        outcome: "FAIL",
                        readingValue: values[item.id],
                        readingUnit: item.unit ?? undefined,
                      },
                    },
                    `${item.label} failed and an exception was raised.`,
                  )
                }
              />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function EvidenceCapture({ eventId }: { eventId: string }) {
  const { client, online } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploaded, setUploaded] = useState<string | null>(null);
  function select(next: File | null) {
    setUploaded(null);
    setProgress(0);
    if (!next) {
      setFile(null);
      return;
    }
    const issue = validateEvidenceFile(next);
    setError(issue);
    setFile(issue ? null : next);
  }
  async function upload() {
    if (!file) return;
    setProgress(10);
    setError(null);
    try {
      const asset = await client.uploadEvidence({
        file,
        ownerId: eventId,
        category: "VEHICLE_INSPECTION_PHOTO",
      });
      setProgress(100);
      setUploaded(asset.id);
      setFile(null);
    } catch (reason) {
      setProgress(0);
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    }
  }
  return (
    <Card>
      <AppText variant="heading">Synthetic evidence</AppText>
      <AppText variant="caption">
        Nothing uploads until you select Upload. GPS metadata is not requested;
        remove location metadata before selection where applicable.
      </AppText>
      <label className="file-button">
        Capture or select evidence
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          capture="environment"
          onChange={(e) => select(e.currentTarget.files?.[0] ?? null)}
        />
      </label>
      {file ? (
        <>
          <AppText>
            {file.name} · {Math.ceil(file.size / 1024)} KB
          </AppText>
          <div className="button-row">
            <Button
              label="Upload evidence"
              disabled={!online}
              onClick={() => void upload()}
            />
            <Button
              tone="secondary"
              label="Remove"
              onClick={() => select(null)}
            />
          </div>
        </>
      ) : null}
      {progress > 0 ? (
        <progress
          max="100"
          value={progress}
          aria-label="Evidence upload progress"
        />
      ) : null}
      {uploaded ? (
        <StatusBadge tone="success" label="Evidence uploaded" />
      ) : null}
      {error ? (
        <Banner tone="danger" title="Evidence not uploaded" message={error} />
      ) : null}
    </Card>
  );
}

function OwnerHome() {
  const { client } = useAuth();
  const [data, setData] = useState<OwnerOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void client
      .ownerOverview()
      .then(setData)
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : "Overview unavailable.",
        ),
      );
  }, [client]);
  if (error)
    return (
      <Screen>
        <Banner tone="danger" title="Overview unavailable" message={error} />
      </Screen>
    );
  if (!data)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  return (
    <Screen>
      <AppText variant="title">Fleet overview</AppText>
      <div className="metrics">
        <Metric label="Vehicles out" value={data.counts.vehiclesOut} />
        <Metric
          label="Overdue"
          value={data.counts.overdue}
          danger={data.counts.overdue > 0}
        />
        <Metric
          label="Awaiting approval"
          value={data.counts.awaitingApproval}
        />
        <Metric
          label="Open exceptions"
          value={data.counts.openExceptions}
          danger={data.counts.openExceptions > 0}
        />
        <Metric
          label="High indicators"
          value={data.counts.highRiskIndicators}
          danger={data.counts.highRiskIndicators > 0}
        />
      </div>
      <Card>
        <AppText variant="heading">Tracker availability</AppText>
        <div className="metrics">
          <Metric label="Fresh" value={data.tracker.fresh} />
          <Metric label="Stale" value={data.tracker.stale} />
          <Metric label="Unavailable" value={data.tracker.unavailable} />
          <Metric label="Synthetic" value={data.tracker.synthetic} />
        </div>
        {data.tracker.synthetic > 0 ? (
          <StatusBadge
            tone="synthetic"
            label="Synthetic tracker data present"
          />
        ) : null}
        <AppText variant="caption">
          Stale or unavailable data is an availability signal, not evidence of
          wrongdoing.
        </AppText>
      </Card>
      <Card>
        <AppText variant="heading">Recent gate activity</AppText>
        {data.recentActivity.map((item) => (
          <button
            className="list-link"
            key={item.id}
            onClick={() => navigate(`guard/events/${item.id}`)}
          >
            <span>{item.label}</span>
            <small>
              {item.outcome} · {new Date(item.occurredAt).toLocaleString()}
            </small>
          </button>
        ))}
      </Card>
      <Card>
        <AppText variant="heading">Recent reconciliations</AppText>
        {data.recentReconciliations.length ? (
          data.recentReconciliations.map((item) => (
            <div className="list-row" key={item.id}>
              <span>{item.referenceCode}</span>
              <StatusBadge
                tone={item.status === "OPEN" ? "warning" : "success"}
                label={item.status}
              />
            </div>
          ))
        ) : (
          <EmptyState
            title="No recent reconciliations"
            message="Completed departure and return legs will appear here."
          />
        )}
      </Card>
      {data.investigationSummaries.length ? (
        <Card>
          <AppText variant="heading">
            Authorized investigation summaries
          </AppText>
          {data.investigationSummaries.map((item) => (
            <div className="list-row" key={item.id}>
              <span>
                {item.caseNumber} · {item.title}
              </span>
              <StatusBadge label={`${item.severity} · ${item.status}`} />
            </div>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
function Metric({
  label,
  value,
  danger,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div
      className={`metric ${danger ? "metric-danger" : ""}`}
      aria-label={`${label}: ${value}`}
    >
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function OwnerMovement({
  id,
  bootstrap,
}: {
  id: string;
  bootstrap: MobileBootstrapResponse;
}) {
  const { client, online } = useAuth();
  const [payload, setPayload] = useState<{
    movement: MobileMovementDetail;
    tracker: GateQueueItem["tracker"];
  } | null>(null);
  const [comments, setComments] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const canApprove =
    bootstrap.principal.permissions.includes("movement:APPROVE");
  useEffect(() => {
    void client.movement(id).then(setPayload);
  }, [client, id]);
  if (!payload)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  const currentPayload = payload;
  async function decide(decision: "APPROVE" | "REJECT") {
    try {
      const result = await client.movementDecision(id, decision, comments);
      setMessage(`Server recorded ${result.movement.status}.`);
      setPayload({
        ...currentPayload,
        movement: {
          ...currentPayload.movement,
          status: result.movement.status,
        },
      });
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Decision failed.");
    }
  }
  return (
    <Screen>
      <AppText variant="title">Movement decision</AppText>
      {message ? (
        <Banner tone="info" title="Decision result" message={message} />
      ) : null}
      <Card>
        <AppText variant="heading">{payload.movement.referenceCode}</AppText>
        <AppText>
          {payload.movement.vehicle.registrationNumber} ·{" "}
          {payload.movement.driver.name}
        </AppText>
        <AppText>{payload.movement.purpose || "No purpose"}</AppText>
        <StatusBadge label={payload.movement.status} />
      </Card>
      <Tracker tracker={payload.tracker} />
      {canApprove && payload.movement.status === "SUBMITTED" ? (
        <Card>
          <Field
            label="Decision comments"
            value={comments}
            onChange={(e) => setComments(e.currentTarget.value)}
          />
          <AppText variant="caption">
            Confirm the vehicle, driver, purpose and consequences. The server
            enforces separation of duties and records the actor/time.
          </AppText>
          <div className="button-row">
            <Button
              label="Approve movement"
              disabled={!online}
              onClick={() => void decide("APPROVE")}
            />
            <Button
              tone="danger"
              label="Reject movement"
              disabled={!online || !comments.trim()}
              onClick={() => void decide("REJECT")}
            />
          </div>
        </Card>
      ) : null}
    </Screen>
  );
}

function Notifications() {
  const { client } = useAuth();
  const [data, setData] = useState<Page<MobileNotification> | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    try {
      setData(await client.notifications());
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Notifications unavailable.",
      );
    }
  }
  useEffect(() => {
    void client
      .notifications()
      .then(setData)
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Notifications unavailable.",
        ),
      );
  }, [client]);
  if (error)
    return (
      <Screen>
        <Banner
          tone="danger"
          title="Notifications unavailable"
          message={error}
        />
      </Screen>
    );
  if (!data)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  return (
    <Screen>
      <AppText variant="title">Notifications</AppText>
      <Banner
        tone="info"
        title="In-app only"
        message="Push, email, SMS and messaging delivery are disabled."
      />
      {data.items.length === 0 ? (
        <EmptyState
          title="No notifications"
          message="Permission-filtered operational notices will appear here."
        />
      ) : (
        <div className="list">
          {data.items.map((notice) => (
            <Card key={notice.id}>
              <div className="row-between">
                <AppText variant="heading">{notice.title}</AppText>
                {!notice.read ? <StatusBadge label="Unread" /> : null}
              </div>
              <AppText>{notice.body}</AppText>
              <AppText variant="caption">
                {new Date(notice.occurredAt).toLocaleString()}
              </AppText>
              <div className="button-row">
                {notice.deepLink ? (
                  <Button
                    label="Open authorized record"
                    onClick={() => navigate(notice.deepLink!)}
                  />
                ) : null}
                {!notice.read ? (
                  <Button
                    tone="secondary"
                    label="Mark read"
                    onClick={() =>
                      void client.markNotificationRead(notice.id).then(load)
                    }
                  />
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Screen>
  );
}

function Profile({ bootstrap }: { bootstrap: MobileBootstrapResponse }) {
  const { signOut, refresh } = useAuth();
  return (
    <Screen>
      <AppText variant="title">Profile</AppText>
      <Card>
        <AppText variant="heading">{bootstrap.principal.name}</AppText>
        <AppText>{bootstrap.principal.roleName}</AppText>
        <AppText>{bootstrap.principal.tenant.name}</AppText>
        <AppText variant="caption">
          Session expires{" "}
          {new Date(bootstrap.principal.sessionExpiresAt).toLocaleString()}
        </AppText>
      </Card>
      <Button
        tone="secondary"
        label="Refresh roles and permissions"
        onClick={() => void refresh()}
      />
      <Button
        tone="danger"
        label="Sign out and clear local session"
        onClick={() => void signOut().then(() => navigate("login", true))}
      />
    </Screen>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
