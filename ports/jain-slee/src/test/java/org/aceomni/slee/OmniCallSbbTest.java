package org.aceomni.slee;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OmniCallSbbTest {
    private static final String T0 = "2026-08-13T10:00:00Z";
    private static final String DIGEST = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    private TestSbb sbb;
    private SyntheticOmniTransportRa transport;

    @BeforeEach
    void setUp() {
        sbb = new TestSbb();
        transport = new SyntheticOmniTransportRa();
        sbb.setTransportForTest(transport);
    }

    @Test
    void completesTwoParticipantRunWithObservation() {
        sbb.handle(OmniEvent.participantJoined("join-a", "run-1", "call-1", "caller", T0));
        assertEquals(OmniRunState.WAITING_FOR_PARTICIPANTS, sbb.state());

        sbb.handle(OmniEvent.participantJoined("join-b", "run-1", "call-1", "callee", T0));
        assertEquals(OmniRunState.READY, sbb.state());
        assertEquals(OmniCommand.Type.START_ACTIVITY, transport.onlyCommand().type());
        assertEquals("run-1", transport.onlyCommand().runId());
        assertEquals("call-1", transport.onlyCommand().activityId());

        sbb.handle(OmniEvent.activityStarted("started", "run-1", "call-1", T0));
        assertEquals(OmniRunState.RUNNING, sbb.state());

        sbb.handle(OmniEvent.observation("obs-1", "run-1", "call-1", "webrtc", T0, DIGEST));
        assertEquals(1, sbb.getObservationCount());

        sbb.handle(OmniEvent.activityEnded("ended", "run-1", "call-1", T0));
        assertEquals(OmniRunState.COMPLETED, sbb.state());

        sbb.handle(OmniEvent.transportFailure("late-failure", "run-1", "call-1", "transport", T0));
        assertEquals(OmniRunState.COMPLETED, sbb.state(), "terminal state must not reopen");
    }

    @Test
    void duplicateEventsAreIdempotent() {
        OmniEvent caller = OmniEvent.participantJoined("join-a", "run-1", "call-1", "caller", T0);
        OmniEvent callee = OmniEvent.participantJoined("join-b", "run-1", "call-1", "callee", T0);

        sbb.handle(caller);
        sbb.handle(caller);
        sbb.handle(callee);
        sbb.handle(callee);

        assertEquals(OmniRunState.READY, sbb.state());
        assertEquals(1, transport.commands().size(), "duplicate delivery must not duplicate commands");
    }

    @Test
    void unrelatedRunOrActivityCannotContaminateState() {
        sbb.handle(OmniEvent.participantJoined("join-a", "run-1", "call-1", "caller", T0));
        sbb.handle(OmniEvent.participantJoined("wrong-run", "run-2", "call-1", "intruder", T0));
        sbb.handle(OmniEvent.participantJoined("wrong-call", "run-1", "call-2", "intruder2", T0));

        assertEquals(OmniRunState.WAITING_FOR_PARTICIPANTS, sbb.state());
        assertEquals("caller", sbb.getParticipantA());
        assertEquals(null, sbb.getParticipantB());
        assertEquals(0, transport.commands().size());
    }

    @Test
    void transportFailureIsTerminal() {
        sbb.handle(OmniEvent.participantJoined("join-a", "run-1", "call-1", "caller", T0));
        sbb.handle(OmniEvent.participantJoined("join-b", "run-1", "call-1", "callee", T0));
        sbb.handle(OmniEvent.transportFailure("failure", "run-1", "call-1", "transport", T0));

        assertEquals(OmniRunState.FAILED, sbb.state());

        sbb.handle(OmniEvent.activityStarted("late-start", "run-1", "call-1", T0));
        assertEquals(OmniRunState.FAILED, sbb.state());
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
