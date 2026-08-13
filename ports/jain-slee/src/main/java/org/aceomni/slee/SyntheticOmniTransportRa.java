package org.aceomni.slee;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Deterministic test implementation of the SBB-facing RA contract.
 *
 * This is deliberately not a deployable ResourceAdaptor yet. It lets the SBB
 * conformance behavior compile and execute against the standard JAIN SLEE API
 * while the micro-JAIN-SLEE container binding is still external.
 */
public final class SyntheticOmniTransportRa implements OmniTransportRaSbbInterface {
    private final List<OmniCommand> commands = new ArrayList<>();

    @Override
    public void execute(OmniCommand command) {
        commands.add(command);
    }

    public List<OmniCommand> commands() {
        return Collections.unmodifiableList(commands);
    }

    public OmniCommand onlyCommand() {
        if (commands.size() != 1) {
            throw new IllegalStateException("expected exactly one command, got " + commands.size());
        }
        return commands.get(0);
    }
}
