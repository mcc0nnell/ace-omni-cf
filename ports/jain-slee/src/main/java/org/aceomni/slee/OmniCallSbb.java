package org.aceomni.slee;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Set;

import javax.naming.InitialContext;
import javax.naming.NamingException;
import javax.slee.ActivityContextInterface;
import javax.slee.CreateException;
import javax.slee.RolledBackContext;
import javax.slee.Sbb;
import javax.slee.SbbContext;

/**
 * First runtime-independent ACE Omni behavior expressed as a JAIN SLEE SBB.
 *
 * The SBB owns experiment/call state and correlation. It never opens a socket
 * or performs transport I/O. External work is issued through the RA contract.
 */
public abstract class OmniCallSbb implements Sbb {
    public static final String TRANSPORT_JNDI = "java:comp/env/slee/resources/omni/transport";

    private transient SbbContext sbbContext;
    private transient OmniTransportRaSbbInterface transport;

    public abstract String getRunId();
    public abstract void setRunId(String value);

    public abstract String getActivityId();
    public abstract void setActivityId(String value);

    public abstract String getRunState();
    public abstract void setRunState(String value);

    public abstract String getParticipantA();
    public abstract void setParticipantA(String value);

    public abstract String getParticipantB();
    public abstract void setParticipantB(String value);

    public abstract String getSeenEventIds();
    public abstract void setSeenEventIds(String value);

    public abstract long getCommandSequence();
    public abstract void setCommandSequence(long value);

    public abstract long getObservationCount();
    public abstract void setObservationCount(long value);

    @Override
    public void setSbbContext(SbbContext context) {
        this.sbbContext = context;
        try {
            this.transport = (OmniTransportRaSbbInterface) new InitialContext().lookup(TRANSPORT_JNDI);
        } catch (NamingException exception) {
            throw new IllegalStateException("Omni transport RA is not bound at " + TRANSPORT_JNDI, exception);
        }
    }

    @Override
    public void unsetSbbContext() {
        this.transport = null;
        this.sbbContext = null;
    }

    @Override
    public void sbbCreate() throws CreateException {
    }

    @Override
    public void sbbPostCreate() throws CreateException {
    }

    @Override
    public void sbbActivate() {
    }

    @Override
    public void sbbPassivate() {
    }

    @Override
    public void sbbRemove() {
    }

    @Override
    public void sbbLoad() {
    }

    @Override
    public void sbbStore() {
    }

    @Override
    public void sbbExceptionThrown(Exception exception, Object event, ActivityContextInterface activity) {
        if (!state().isTerminal()) {
            setState(OmniRunState.FAILED);
        }
    }

    @Override
    public void sbbRolledBack(RolledBackContext context) {
    }

    /**
     * Generic event handler for the first port. Container-specific deployment
     * descriptors may split this into typed handlers without changing behavior.
     */
    public void onOmniEvent(OmniEvent event, ActivityContextInterface activity) {
        handle(event);
    }

    /**
     * Pure deterministic transition entry point, also used by conformance tests.
     */
    public final void handle(OmniEvent event) {
        if (event == null) {
            throw new IllegalArgumentException("event is required");
        }

        OmniRunState current = state();
        if (current.isTerminal()) {
            return;
        }

        if (getRunId() == null) {
            setRunId(event.runId());
            setActivityId(event.activityId());
        } else if (!getRunId().equals(event.runId()) || !getActivityId().equals(event.activityId())) {
            return;
        }

        Set<String> seen = seenEventIds();
        if (!seen.add(event.eventId())) {
            return;
        }
        setSeenEventIds(String.join(",", seen));

        switch (event.type()) {
            case PARTICIPANT_JOINED -> participantJoined(event.participantId());
            case PARTICIPANT_LEFT -> participantLeft(event.participantId());
            case ACTIVITY_STARTED -> activityStarted();
            case OBSERVATION_RECEIVED -> observationReceived();
            case ACTIVITY_ENDED -> activityEnded();
            case TRANSPORT_FAILURE -> setState(OmniRunState.FAILED);
        }
    }

    public final OmniRunState state() {
        String value = getRunState();
        return value == null || value.isBlank() ? OmniRunState.CREATED : OmniRunState.valueOf(value);
    }

    private void participantJoined(String participantId) {
        if (participantId.equals(getParticipantA()) || participantId.equals(getParticipantB())) {
            return;
        }

        if (getParticipantA() == null) {
            setParticipantA(participantId);
            setState(OmniRunState.WAITING_FOR_PARTICIPANTS);
            return;
        }

        if (getParticipantB() == null) {
            setParticipantB(participantId);
            setState(OmniRunState.READY);
            long sequence = getCommandSequence() + 1;
            setCommandSequence(sequence);
            requireTransport().execute(OmniCommand.startActivity(
                    "command:start:" + sequence,
                    getRunId(),
                    getActivityId(),
                    sequence));
        }
    }

    private void participantLeft(String participantId) {
        if (participantId == null) {
            return;
        }
        if (state() == OmniRunState.RUNNING &&
                (participantId.equals(getParticipantA()) || participantId.equals(getParticipantB()))) {
            setState(OmniRunState.ENDING);
        }
    }

    private void activityStarted() {
        if (state() == OmniRunState.READY) {
            setState(OmniRunState.RUNNING);
        }
    }

    private void observationReceived() {
        if (state() == OmniRunState.RUNNING) {
            setObservationCount(getObservationCount() + 1);
        }
    }

    private void activityEnded() {
        if (state() == OmniRunState.RUNNING || state() == OmniRunState.ENDING) {
            setState(OmniRunState.COMPLETED);
        }
    }

    private void setState(OmniRunState state) {
        setRunState(state.name());
    }

    private Set<String> seenEventIds() {
        String raw = getSeenEventIds();
        if (raw == null || raw.isBlank()) {
            return new LinkedHashSet<>();
        }
        return new LinkedHashSet<>(Arrays.asList(raw.split(",")));
    }

    private OmniTransportRaSbbInterface requireTransport() {
        if (transport == null) {
            throw new IllegalStateException("Omni transport RA is not available");
        }
        return transport;
    }

    final void setTransportForTest(OmniTransportRaSbbInterface transport) {
        this.transport = transport;
    }

    protected final SbbContext sbbContext() {
        return sbbContext;
    }
}
