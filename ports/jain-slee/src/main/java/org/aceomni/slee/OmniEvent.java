package org.aceomni.slee;

import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.regex.Pattern;

public record OmniEvent(
        String eventId,
        String runId,
        String activityId,
        Type type,
        String participantId,
        String sourceId,
        String observedAt,
        String payloadDigest
) implements Serializable {

    private static final long serialVersionUID = 1L;
    private static final Pattern STABLE_ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:-]{0,119}");

    public enum Type {
        PARTICIPANT_JOINED,
        PARTICIPANT_LEFT,
        ACTIVITY_STARTED,
        OBSERVATION_RECEIVED,
        ACTIVITY_ENDED,
        TRANSPORT_FAILURE
    }

    public OmniEvent {
        requireStableId(eventId, "eventId");
        requireStableId(runId, "runId");
        requireStableId(activityId, "activityId");
        Objects.requireNonNull(type, "type");
        Instant.parse(Objects.requireNonNull(observedAt, "observedAt"));

        if (participantId != null) {
            requireStableId(participantId, "participantId");
        }
        if (sourceId != null) {
            requireStableId(sourceId, "sourceId");
        }
        if (payloadDigest != null && !payloadDigest.matches("[a-fA-F0-9]{64}")) {
            throw new IllegalArgumentException("payloadDigest must be a SHA-256 hex digest");
        }
        if (type == Type.PARTICIPANT_JOINED && participantId == null) {
            throw new IllegalArgumentException("participantId is required for PARTICIPANT_JOINED");
        }
        if (type == Type.OBSERVATION_RECEIVED && (sourceId == null || payloadDigest == null)) {
            throw new IllegalArgumentException("sourceId and payloadDigest are required for OBSERVATION_RECEIVED");
        }
    }

    public static OmniEvent participantJoined(
            String eventId, String runId, String activityId, String participantId, String observedAt) {
        return new OmniEvent(
                eventId, runId, activityId, Type.PARTICIPANT_JOINED,
                participantId, null, observedAt, null);
    }

    public static OmniEvent activityStarted(
            String eventId, String runId, String activityId, String observedAt) {
        return new OmniEvent(
                eventId, runId, activityId, Type.ACTIVITY_STARTED,
                null, "transport", observedAt, null);
    }

    public static OmniEvent observation(
            String eventId,
            String runId,
            String activityId,
            String sourceId,
            String observedAt,
            String payloadDigest) {
        return new OmniEvent(
                eventId, runId, activityId, Type.OBSERVATION_RECEIVED,
                null, sourceId, observedAt, payloadDigest);
    }

    public static OmniEvent activityEnded(
            String eventId, String runId, String activityId, String observedAt) {
        return new OmniEvent(
                eventId, runId, activityId, Type.ACTIVITY_ENDED,
                null, "transport", observedAt, null);
    }

    public static OmniEvent transportFailure(
            String eventId, String runId, String activityId, String sourceId, String observedAt) {
        return new OmniEvent(
                eventId, runId, activityId, Type.TRANSPORT_FAILURE,
                null, sourceId, observedAt, null);
    }

    private static void requireStableId(String value, String label) {
        if (value == null || !STABLE_ID.matcher(value).matches()) {
            throw new IllegalArgumentException(label + " must be a stable identifier");
        }
    }
}
