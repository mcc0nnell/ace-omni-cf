import {
  EvidenceProjectionSchema,
  renderEvidenceHtml as renderEvidenceHtmlUnchecked,
  renderEvidenceSvg as renderEvidenceSvgUnchecked,
  sha256Canonical,
  type EvidenceProjection,
  type EvidenceRendererProfile,
  type RenderedEvidence,
} from "./evidence-rendering";

export {
  ASSURANCE_CARD_V1,
  EvidenceDisclosureClassSchema,
  EvidenceFieldBindingSchema,
  EvidenceProjectionArtifactTypeSchema,
  EvidenceProjectionFactSchema,
  EvidenceProjectionPolicySchema,
  EvidenceProjectionSchema,
  EvidenceProjectionStatusSchema,
  EvidenceProjectionTraceEntrySchema,
  EvidenceRendererProfileSchema,
  buildEvidenceProjection,
  canonicalJson,
  sha256Canonical,
  type EvidenceDisclosureClass,
  type EvidenceFieldBinding,
  type EvidenceProjection,
  type EvidenceProjectionArtifactType,
  type EvidenceProjectionFact,
  type EvidenceProjectionPolicy,
  type EvidenceProjectionSpec,
  type EvidenceProjectionStatus,
  type EvidenceProjectionTraceEntry,
  type EvidenceRendererProfile,
  type NormalizedEvidenceProjectionPolicy,
  type RenderedEvidence,
} from "./evidence-rendering";

function contentForProjectionDigest(projection: EvidenceProjection): Omit<EvidenceProjection, "projectionDigest"> {
  const { projectionDigest: _projectionDigest, ...content } = projection;
  return content;
}

export async function verifyEvidenceProjectionIntegrity(
  inputProjection: EvidenceProjection,
): Promise<EvidenceProjection> {
  const projection = EvidenceProjectionSchema.parse(inputProjection);
  const expectedDigest = await sha256Canonical(contentForProjectionDigest(projection));

  if (projection.projectionDigest !== expectedDigest) {
    throw new Error(
      `Evidence projection digest mismatch: expected ${expectedDigest}, received ${projection.projectionDigest}`,
    );
  }

  return projection;
}

export async function verifyEvidenceProjectionAgainstSource(
  inputProjection: EvidenceProjection,
  authoritativeSource: unknown,
): Promise<EvidenceProjection> {
  const projection = await verifyEvidenceProjectionIntegrity(inputProjection);
  const expectedSourceDigest = await sha256Canonical(authoritativeSource);

  if (projection.source.digest !== expectedSourceDigest) {
    throw new Error(
      `Evidence source digest mismatch: expected ${expectedSourceDigest}, received ${projection.source.digest}`,
    );
  }

  return projection;
}

export async function renderEvidenceHtml(
  inputProjection: EvidenceProjection,
  profile?: EvidenceRendererProfile,
): Promise<RenderedEvidence> {
  const projection = await verifyEvidenceProjectionIntegrity(inputProjection);
  return renderEvidenceHtmlUnchecked(projection, profile);
}

export async function renderEvidenceSvg(
  inputProjection: EvidenceProjection,
  profile?: EvidenceRendererProfile,
): Promise<RenderedEvidence> {
  const projection = await verifyEvidenceProjectionIntegrity(inputProjection);
  return renderEvidenceSvgUnchecked(projection, profile);
}
