package org.aceomni.slee;

public enum OmniRunState {
    CREATED,
    WAITING_FOR_PARTICIPANTS,
    READY,
    RUNNING,
    ENDING,
    COMPLETED,
    FAILED;

    public boolean isTerminal() {
        return this == COMPLETED || this == FAILED;
    }
}
