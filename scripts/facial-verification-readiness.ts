import { buildFacialVerificationReadinessReport } from "../src/lib/operations/facial-verification-readiness";

const report = buildFacialVerificationReadinessReport(process.env);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.activationReady ? 0 : 1;
