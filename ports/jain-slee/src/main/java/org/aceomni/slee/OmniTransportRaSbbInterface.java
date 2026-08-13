package org.aceomni.slee;

/**
 * SBB-facing Resource Adaptor contract for the first Omni SLEE slice.
 *
 * The SBB owns experiment behavior. Implementations own I/O and translate
 * commands into external runtime work, then report results back as SLEE events.
 */
public interface OmniTransportRaSbbInterface {
    void execute(OmniCommand command);
}
