package org.aceomni.slee;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.junit.jupiter.api.Test;

class OmniConformanceFixtureTest {
    private static final ObjectMapper JSON = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT);
    private static final String DEFAULT_DIGEST =
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    @Test
    void emitsCanonicalSemanticTracesForEveryFixture() throws Exception {
        Path fixturesDir = Path.of(System.getProperty("omni.conformance.fixtures"));
        Path outputDir = Path.of(System.getProperty("omni.conformance.output"));
        Files.createDirectories(outputDir);

        List<Path> fixtures;
        try (var stream = Files.list(fixturesDir)) {
            fixtures = stream
                    .filter(path -> path.getFileName().toString().endsWith(".json"))
                    .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                    .toList();
        }
        if (fixtures.isEmpty()) {
            throw new IllegalStateException("No Omni conformance fixtures found at " + fixturesDir);
        }

        for (Path path : fixtures) {
            Fixture fixture = JSON.readValue(path.toFile(), Fixture.class);
            Output output = runFixture(fixture);
            assertEquals(fixture.expected().terminalState(), output.terminalState(), fixture.name());
            assertEquals(fixture.expected().trace(), output.trace(), fixture.name());

            Path outputPath = outputDir.resolve(path.getFileName());
            JSON.writeValue(outputPath.toFile(), output);
        }
    }

    private Output runFixture(Fixture fixture) {
        TestSbb sbb = new TestSbb();
        SyntheticOmniTransportRa transport = new SyntheticOmniTransportRa();
        sbb.setTransportForTest(transport);
        List<TraceEntry> trace = new ArrayList<>();

        for (FixtureEvent input : fixture.events()) {
            String runId = input.runId() == null ? fixture.runId() : input.runId();
            String activityId = input.activityId() == null ? fixture.activityId() : input.activityId();
            Set<String> beforeIds = parseSeen(sbb.getSeenEventIds());
            int commandCountBefore = transport.commands().size();
            long observationsBefore = sbb.getObservationCount();

            sbb.handle(toOmniEvent(fixture, input, runId, activityId));

            Set<String> afterIds = parseSeen(sbb.getSeenEventIds());
            boolean accepted = !beforeIds.contains(input.eventId()) && afterIds.contains(input.eventId());
            List<String> commands = transport.commands().subList(
                    commandCountBefore,
                    transport.commands().size())
                    .stream()
                    .map(command -> command.type().name())
                    .toList();

            trace.add(new TraceEntry(
                    input.eventId(),
                    accepted,
                    normalizeState(sbb.state()),
                    commands,
                    sbb.getObservationCount() - observationsBefore));
        }

        return new Output(1, fixture.name(), normalizeState(sbb.state()), trace);
    }

    private OmniEvent toOmniEvent(
            Fixture fixture,
            FixtureEvent input,
            String runId,
            String activityId) {
        String observedAt = fixture.observedAt();
        return switch (input.type()) {
            case "participant_joined" -> OmniEvent.participantJoined(
                    input.eventId(), runId, activityId, input.participantId(), observedAt);
            case "participant_left" -> new OmniEvent(
                    input.eventId(), runId, activityId, OmniEvent.Type.PARTICIPANT_LEFT,
                    input.participantId(), null, observedAt, null);
            case "activity_started" -> OmniEvent.activityStarted(
                    input.eventId(), runId, activityId, observedAt);
            case "observation" -> OmniEvent.observation(
                    input.eventId(),
                    runId,
                    activityId,
                    input.sourceId() == null ? "conformance" : input.sourceId(),
                    observedAt,
                    input.payloadSha256() == null ? DEFAULT_DIGEST : input.payloadSha256());
            case "activity_ended" -> OmniEvent.activityEnded(
                    input.eventId(), runId, activityId, observedAt);
            case "transport_failure" -> OmniEvent.transportFailure(
                    input.eventId(),
                    runId,
                    activityId,
                    input.sourceId() == null ? "transport" : input.sourceId(),
                    observedAt);
            default -> throw new IllegalArgumentException("Unknown fixture event type: " + input.type());
        };
    }

    private static String normalizeState(OmniRunState state) {
        return switch (state) {
            case CREATED -> "CREATED";
            case WAITING_FOR_PARTICIPANTS -> "WAITING";
            case READY -> "READY";
            case RUNNING -> "RUNNING";
            case ENDING -> "ENDING";
            case COMPLETED -> "COMPLETED";
            case FAILED -> "FAILED";
        };
    }

    private static Set<String> parseSeen(String raw) {
        if (raw == null || raw.isBlank()) return new LinkedHashSet<>();
        return new LinkedHashSet<>(Arrays.asList(raw.split(",")));
    }

    public record Fixture(
            int version,
            String name,
            String runId,
            String activityId,
            String observedAt,
            List<FixtureEvent> events,
            Expected expected) {
    }

    public record FixtureEvent(
            String eventId,
            String type,
            String participantId,
            String runId,
            String activityId,
            String sourceId,
            String payloadSha256,
            String reason) {
    }

    public record Expected(String terminalState, List<TraceEntry> trace) {
    }

    public record TraceEntry(
            String eventId,
            boolean accepted,
            String state,
            List<String> commands,
            long observationDelta) {
    }

    public record Output(
            int version,
            String fixture,
            String terminalState,
            List<TraceEntry> trace) {
    }

    private static final class TestSbb extends OmniCallSbb {
        private String runId;
        private String activityId;
        private String runState;
        private String participantA;
        private String participantB;
        private String seenEventIds;
        private long commandSequence;
        private long observationCount;

        @Override public String getRunId() { return runId; }
        @Override public void setRunId(String value) { runId = value; }
        @Override public String getActivityId() { return activityId; }
        @Override public void setActivityId(String value) { activityId = value; }
        @Override public String getRunState() { return runState; }
        @Override public void setRunState(String value) { runState = value; }
        @Override public String getParticipantA() { return participantA; }
        @Override public void setParticipantA(String value) { participantA = value; }
        @Override public String getParticipantB() { return participantB; }
        @Override public void setParticipantB(String value) { participantB = value; }
        @Override public String getSeenEventIds() { return seenEventIds; }
        @Override public void setSeenEventIds(String value) { seenEventIds = value; }
        @Override public long getCommandSequence() { return commandSequence; }
        @Override public void setCommandSequence(long value) { commandSequence = value; }
        @Override public long getObservationCount() { return observationCount; }
        @Override public void setObservationCount(long value) { observationCount = value; }
    }
}
