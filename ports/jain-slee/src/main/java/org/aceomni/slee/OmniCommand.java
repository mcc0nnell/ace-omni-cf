package org.aceomni.slee;

import java.io.Serializable;
import java.util.Objects;
import java.util.regex.Pattern;

public record OmniCommand(
        String commandId,
        String runId,
        String activityId,
        Type type,
        long sequence
) implements Serializable {

    private static final long serialVersionUID = 1L;
    private static final Pattern STABLE_ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:-]{0,119}");

    public enum Type {
        START_ACTIVITY,
        END_ACTIVITY
    }

    public OmniCommand {
        requireStableId(commandId, "commandId");
        requireStableId(runId, "runId");
        requireStableId(activityId, "activityId");
        Objects.requireNonNull(type, "type");
        if (sequence < 1) {
            throw new IllegalArgumentException("sequence must be positive");
        }
    }

    public static OmniCommand startActivity(String commandId, String runId, String activityId, long sequence) {
        return new OmniCommand(commandId, runId, activityId, Type.START_ACTIVITY, sequence);
    }

    private static void requireStableId(String value, String label) {
        if (value == null || !STABLE_ID.matcher(value).matches()) {
            throw new IllegalArgumentException(label + " must be a stable identifier");
        }
    }
}
