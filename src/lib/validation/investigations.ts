import { z } from "zod";

const priorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const confidentialityEnum = z.enum(["STANDARD", "RESTRICTED", "HIGHLY_RESTRICTED"]);
const categoryEnum = z.enum(["FRAUD", "THEFT", "SAFETY", "POLICY_VIOLATION", "MISCONDUCT", "DATA_INTEGRITY", "UNAUTHORISED_USE", "OTHER"]);
const sourceEnum = z.enum([
  "GATE_EXCEPTION",
  "FACIAL_VERIFICATION_FAILURE",
  "VEHICLE_INSPECTION_FAILURE",
  "CARGO_LOAD_DISCREPANCY",
  "RECONCILIATION_DISCREPANCY",
  "GPS_GEOFENCE_EXCEPTION",
  "MISSING_EVIDENCE",
  "SUSPECTED_UNAUTHORISED_USE",
  "ODOMETER_FUEL_CONDITION_DISCREPANCY",
  "MANUAL_CONCERN",
  "OTHER",
]);
const outcomeEnum = z.enum(["NOT_DETERMINED", "SUBSTANTIATED", "UNSUBSTANTIATED", "INCONCLUSIVE", "REFERRED_FOR_FURTHER_ACTION"]);
const partyRoleEnum = z.enum(["SUBJECT", "WITNESS", "OTHER_INVOLVED_PARTY"]);
const noteTypeEnum = z.enum(["GENERAL", "INTERVIEW", "ANALYSIS", "DECISION", "SYSTEM"]);
const taskStatusEnum = z.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]);
const relatedRecordTypeEnum = z.enum([
  "EXCEPTION",
  "GATE_EVENT",
  "GATE_EVENT_INSPECTION_ITEM",
  "MOVEMENT_AUTHORISATION",
  "RECONCILIATION",
  "RECONCILIATION_DISCREPANCY",
  "FACIAL_VERIFICATION_ATTEMPT",
  "TELEMATICS_EVENT",
  "VEHICLE",
  "DRIVER",
  "OTHER",
]);

export const createInvestigationCaseSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  description: z.string().trim().min(1, "Description is required").max(10000),
  source: sourceEnum,
  category: categoryEnum.optional().nullable(),
  priority: priorityEnum.optional(),
  confidentiality: confidentialityEnum.optional(),
  reportingPersonUserId: z.string().trim().min(1).optional().nullable(),
  reportingPersonName: z.string().trim().max(300).optional().nullable(),
  caseOwnerUserId: z.string().trim().min(1).optional().nullable(),
});

export const referralSourceTypeEnum = z.enum(["EXCEPTION", "FACIAL_VERIFICATION_ATTEMPT", "GATE_EVENT_INSPECTION_ITEM", "RECONCILIATION_DISCREPANCY"]);

export const createReferralSchema = z.object({
  sourceType: referralSourceTypeEnum,
  sourceRecordId: z.string().trim().min(1, "A source record id is required"),
  title: z.string().trim().min(1, "Title is required").max(300),
  category: categoryEnum.optional().nullable(),
  priority: priorityEnum.optional(),
  confidentiality: confidentialityEnum.optional(),
  caseOwnerUserId: z.string().trim().min(1, "A case owner is required"),
});

export const triageCaseSchema = z.object({
  category: categoryEnum.optional().nullable(),
  priority: priorityEnum.optional(),
});

export const assignInvestigatorSchema = z.object({
  investigatorUserId: z.string().trim().min(1, "An investigator is required"),
});

export const escalateCaseSchema = z.object({
  priority: priorityEnum,
  reason: z.string().trim().min(1, "A reason is required").max(2000),
});

export const requestInformationSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required").max(2000),
});

export const reopenCaseSchema = z.object({
  reopenReason: z.string().trim().min(1, "A reopen reason is required").max(2000),
});

export const closeCaseSchema = z.object({
  approvedFindingId: z.string().trim().min(1, "An approved finding is required"),
});

export const linkRelatedRecordSchema = z.object({
  recordType: relatedRecordTypeEnum,
  recordId: z.string().trim().min(1),
  snapshotSummary: z.record(z.string(), z.unknown()),
});

export const addSubjectSchema = z.object({
  role: partyRoleEnum,
  userId: z.string().trim().min(1).optional().nullable(),
  driverId: z.string().trim().min(1).optional().nullable(),
  vehicleId: z.string().trim().min(1).optional().nullable(),
  contractorName: z.string().trim().max(300).optional().nullable(),
  department: z.string().trim().max(300).optional().nullable(),
  site: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

export const subjectResponseSchema = z.object({
  explanationResponse: z.string().trim().min(1, "A response is required").max(10000),
});

export const addNoteSchema = z.object({
  content: z.string().trim().min(1, "Note content is required").max(10000),
  noteType: noteTypeEnum.optional(),
  confidentiality: confidentialityEnum.optional(),
});

export const amendNoteSchema = z.object({
  content: z.string().trim().min(1, "Amended content is required").max(10000),
});

export const createTaskSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(2000),
  assignedToUserId: z.string().trim().min(1, "An assignee is required"),
  dueDate: z.coerce.date().optional().nullable(),
});

export const updateTaskSchema = z.object({
  status: taskStatusEnum.optional(),
  completionNote: z.string().trim().max(2000).optional().nullable(),
});

export const linkEvidenceSchema = z.object({
  mediaAssetId: z.string().trim().min(1, "A media asset is required"),
  description: z.string().trim().min(1, "Description is required").max(2000),
  sourceRecordType: z.string().trim().max(100).optional().nullable(),
  sourceRecordId: z.string().trim().max(200).optional().nullable(),
  relevance: z.string().trim().max(2000).optional().nullable(),
  confidentiality: confidentialityEnum.optional(),
});

export const enteredInErrorSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required").max(2000),
});

export const releaseHoldSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required").max(2000),
});

export const findingFieldsSchema = z.object({
  executiveSummary: z.string().trim().min(1, "Executive summary is required").max(5000),
  detailedFindings: z.string().trim().min(1, "Detailed findings are required").max(20000),
  evidenceRelied: z.string().trim().max(10000).optional().nullable(),
  contradictoryEvidence: z.string().trim().max(10000).optional().nullable(),
  subjectResponseSummary: z.string().trim().max(10000).optional().nullable(),
  outcome: outcomeEnum,
  recommendations: z.string().trim().max(10000).optional().nullable(),
  correctiveActions: z.string().trim().max(10000).optional().nullable(),
  controlWeaknesses: z.string().trim().max(10000).optional().nullable(),
  followUpDate: z.coerce.date().optional().nullable(),
});

export const approveFindingSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});

export const reasonRequiredSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required").max(2000),
});

export const grantExternalAccessSchema = z.object({
  externalAuditorUserId: z.string().trim().min(1, "An external auditor user is required"),
  caseIds: z.array(z.string().trim().min(1)).min(1, "At least one case is required"),
  reason: z.string().trim().min(1, "A reason is required").max(2000),
  expiresAt: z.coerce.date(),
  canDownloadReport: z.boolean().optional(),
  canDownloadEvidence: z.boolean().optional(),
});

export const updateInvestigationSettingsSchema = z.object({
  casePrefix: z.string().trim().min(1).max(20).optional(),
  enforceSeparationOfDuties: z.boolean().optional(),
  requireDualApprovalForHighSeverityHoldRelease: z.boolean().optional(),
});
