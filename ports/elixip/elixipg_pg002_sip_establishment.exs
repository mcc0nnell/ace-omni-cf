defmodule ElixiPG.PG002.SipEstablishment do
  @moduledoc """
  PG-002: bind Omni START_ACTIVITY to Elixip's real SIP transaction/dialog lifecycle.

  The trial uses Elixip's own SIP.Test.Transport.UDPMockup. That keeps execution
  deterministic while still exercising Elixip SIP message serialization/parsing,
  transaction handling, dialog establishment, ACK/BYE behavior, and SDP processing.
  Media connectivity is observed through Elixip's MediaServer.Mockup; RTP
  interoperability is explicitly outside PG-002's claim.
  """

  use SIP.Scenario

  @callee "sip:callee@elixipg.invalid;unittest=pg002"

  config username: "pg002-caller",
         authusername: "pg002-caller",
         displayname: "ElixiPG PG-002",
         domain: "elixipg.invalid",
         passwd: "pg002"

  state initial_state do
    output_path = System.fetch_env!("ELIXIPG_PG002_TRACE_OUT")
    correlation_id = System.get_env("ELIXIPG_PG002_CORRELATION") || "pg002-run-001"

    appdata_set(:pg002_output_path, output_path)
    appdata_set(:pg002_correlation_id, correlation_id)
    appdata_set(:pg002_observations, [])

    transport_uri = SIP.Transport.Selector.select_transport(@callee)

    case transport_uri do
      %SIP.Uri{tp_pid: transport_pid} when is_pid(transport_pid) ->
        :ok = GenServer.call(transport_pid, :settestapp)
        SIP.Test.Transport.UDPMockup.answer_bye(transport_pid, true)
        appdata_set(:pg002_transport_pid, transport_pid)

        appdata_set(
          :pg002_observations,
          append_observation(
            appdata_get(:pg002_observations),
            correlation_id,
            "START_ACTIVITY",
            "omni",
            %{"command" => "START_ACTIVITY"}
          )
        )

        media_connect(MediaServer.Mockup, "sip:localhost:8080")
        goto(start_call)

      other ->
        scenario_failure("PG-002 could not acquire Elixip test transport: #{inspect(other)}")
    end
  end

  state start_call do
    correlation_id = appdata_get(:pg002_correlation_id)

    appdata_set(
      :pg002_observations,
      append_observation(
        appdata_get(:pg002_observations),
        correlation_id,
        "SIP_INVITE_SENT",
        "elixip",
        %{"target" => @callee}
      )
    )

    send_INVITE(@callee, :mediaserver, [timeout: 5, webrtc: :no, media: :tc])

    if ctx_get(:lasterr) == :ok do
      SIP.Test.Transport.UDPMockup.simulate_successful_answer(appdata_get(:pg002_transport_pid))
      goto(call_progress)
    else
      scenario_failure("PG-002 INVITE could not be issued: #{inspect(ctx_get(:lasterr))}")
    end
  end

  state call_progress do
    on_events do
      {:invite_sent, invite} ->
        appdata_set(
          :pg002_observations,
          append_observation(
            appdata_get(:pg002_observations),
            appdata_get(:pg002_correlation_id),
            "SIP_INVITE_OBSERVED",
            "elixip-transport",
            %{"method" => to_string(invite.method)}
          )
        )

        goto(loop, "INVITE serialized")

      {100, _rsp, _trans_pid, _dialog_pid} ->
        appdata_set(
          :pg002_observations,
          append_observation(
            appdata_get(:pg002_observations),
            appdata_get(:pg002_correlation_id),
            "SIP_100_RECEIVED",
            "elixip",
            %{"code" => 100}
          )
        )

        goto(loop, "100 Trying")

      {180, _rsp, _trans_pid, _dialog_pid} ->
        appdata_set(
          :pg002_observations,
          append_observation(
            appdata_get(:pg002_observations),
            appdata_get(:pg002_correlation_id),
            "SIP_180_RECEIVED",
            "elixip",
            %{"code" => 180}
          )
        )

        goto(loop, "180 Ringing")

      {200, rsp, trans_pid, _dialog_pid} ->
        appdata_set(
          :pg002_observations,
          append_observation(
            appdata_get(:pg002_observations),
            appdata_get(:pg002_correlation_id),
            "SIP_200_RECEIVED",
            "elixip",
            %{"code" => 200, "method" => "INVITE"}
          )
        )

        process_invite_reply(rsp, trans_pid)

        appdata_set(
          :pg002_observations,
          append_observation(
            appdata_get(:pg002_observations),
            appdata_get(:pg002_correlation_id),
            "SIP_ACK_SENT",
            "elixip",
            %{}
          )
        )

        appdata_set(
          :pg002_observations,
          append_observation(
            appdata_get(:pg002_observations),
            appdata_get(:pg002_correlation_id),
            "DIALOG_ESTABLISHED",
            "elixip",
            %{}
          )
        )

        goto(wait_media)

      {code, _rsp, _trans_pid, _dialog_pid} when code in 300..699 ->
        scenario_failure("PG-002 INVITE failed with SIP #{code}")
    after
      5_000 -> scenario_failure("PG-002 INVITE establishment timed out")
    end
  end

  state wait_media do
    on_events do
      {:ms_event, _conn, {:media_connected, media}} ->
        appdata_set(
          :pg002_observations,
          append_observation(
            appdata_get(:pg002_observations),
            appdata_get(:pg002_correlation_id),
            "MEDIA_CONNECTED",
            "elixip-media",
            %{"media" => to_string(media)}
          )
        )

        goto(loop, "media #{media}")

      {:ms_event, _conn, :ice_connected} ->
        appdata_set(
          :pg002_observations,
          append_observation(
            appdata_get(:pg002_observations),
            appdata_get(:pg002_correlation_id),
            "MEDIA_OBSERVED",
            "elixip-media",
            %{
              "adapter" => "MediaServer.Mockup",
              "scope" => "SDP/connectivity observation; RTP interoperability not claimed"
            }
          )
        )

        appdata_set(
          :pg002_observations,
          append_observation(
            appdata_get(:pg002_observations),
            appdata_get(:pg002_correlation_id),
            "SIP_BYE_SENT",
            "elixip",
            %{}
          )
        )

        send_BYE()
        goto(hangup)

      {:ms_event, _conn, {:media_error, reason}} ->
        scenario_failure("PG-002 media negotiation failed: #{inspect(reason)}")
    after
      5_000 -> scenario_failure("PG-002 media observation timed out")
    end
  end

  state hangup do
    on_events do
      :BYE ->
        appdata_set(
          :pg002_observations,
          append_observation(
            appdata_get(:pg002_observations),
            appdata_get(:pg002_correlation_id),
            "SIP_BYE_OBSERVED",
            "elixip-transport",
            %{}
          )
        )

        goto(loop, "BYE serialized")

      {200, _rsp, _trans_pid, _dialog_pid} ->
        appdata_set(
          :pg002_observations,
          append_observation(
            appdata_get(:pg002_observations),
            appdata_get(:pg002_correlation_id),
            "SIP_BYE_200_RECEIVED",
            "elixip",
            %{"code" => 200, "method" => "BYE"}
          )
        )

        goto(wait_termination)
    after
      5_000 -> scenario_failure("PG-002 BYE teardown timed out")
    end
  end

  state wait_termination do
    on_events do
      {:dialog_terminated, _dialog_pid, reason} ->
        appdata_set(
          :pg002_observations,
          append_observation(
            appdata_get(:pg002_observations),
            appdata_get(:pg002_correlation_id),
            "DIALOG_TERMINATED",
            "elixip",
            %{"reason" => inspect(reason)}
          )
        )

        output_path = appdata_get(:pg002_output_path)
        correlation_id = appdata_get(:pg002_correlation_id)

        output = %{
          "version" => 1,
          "trialId" => "PG-002",
          "runtime" => "elixip",
          "correlationId" => correlation_id,
          "terminalState" => "COMPLETED",
          "verdict" => "pass",
          "conditions" => %{
            "sipTransport" => "SIP.Test.Transport.UDPMockup",
            "sipClaim" => "real Elixip SIP serialization/parsing, transactions, and dialog semantics; no wire interoperability claim",
            "mediaAdapter" => "MediaServer.Mockup",
            "mediaClaim" => "SDP/connectivity observation; no RTP interoperability claim"
          },
          "observations" => appdata_get(:pg002_observations)
        }

        File.mkdir_p!(Path.dirname(output_path))
        File.write!(output_path, Jason.encode!(output, pretty: true) <> "\n")

        media_cleanup_ressources()
        scenario_success("PG-002 SIP establishment proven")
    after
      5_000 -> scenario_failure("PG-002 dialog termination timed out")
    end
  end

  defp append_observation(observations, correlation_id, type, source, details) do
    observations = observations || []

    observations ++
      [
        %{
          "sequence" => length(observations) + 1,
          "correlationId" => correlation_id,
          "type" => type,
          "source" => source,
          "details" => details
        }
      ]
  end
end
