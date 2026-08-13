defmodule Omni.ConformanceScenario do
  @moduledoc """
  ACE Omni Core conformance scenario executed by the real Elixip SIP.Scenario engine.

  This first Elixip slice deliberately keeps transport synthetic: it proves that the
  Omni event/behavior grammar can execute inside Elixip's FSM runtime before a later
  slice maps START_ACTIVITY to real SIP/dialog/media work.
  """

  use SIP.Scenario

  config username: "omni-conformance",
         domain: "example.invalid"

  state initial_state do
    fixture_path = System.fetch_env!("OMNI_FIXTURE")
    output_path = System.fetch_env!("OMNI_TRACE_OUT")
    fixture = fixture_path |> File.read!() |> Jason.decode!()

    appdata_set(:fixture, fixture)
    appdata_set(:output_path, output_path)
    appdata_set(:remaining_events, fixture["events"] || [])
    appdata_set(:trace, [])
    appdata_set(:machine, %{
      run_id: nil,
      activity_id: nil,
      state: "CREATED",
      participants: [],
      seen: MapSet.new(),
      observations: 0
    })

    send(self(), :omni_next)
    goto consume
  end

  state consume do
    on_events do
      :omni_next ->
        case appdata_get(:remaining_events) do
          [] ->
            send(self(), :omni_done)
            goto loop

          [event | rest] ->
            fixture = appdata_get(:fixture)
            {machine, trace_entry} = apply_event(appdata_get(:machine), fixture, event)

            appdata_set(:machine, machine)
            appdata_set(:remaining_events, rest)
            appdata_set(:trace, appdata_get(:trace) ++ [trace_entry])

            send(self(), if(rest == [], do: :omni_done, else: :omni_next))
            goto loop, "Omni #{event["eventId"]}"
        end

      :omni_done ->
        fixture = appdata_get(:fixture)
        machine = appdata_get(:machine)
        output_path = appdata_get(:output_path)
        output = %{
          "version" => 1,
          "fixture" => fixture["name"],
          "terminalState" => machine.state,
          "trace" => appdata_get(:trace)
        }

        File.mkdir_p!(Path.dirname(output_path))
        File.write!(output_path, Jason.encode!(output, pretty: true) <> "\n")
        scenario_success("Omni #{fixture["name"]}: #{machine.state}")
    after
      5_000 -> scenario_failure("Omni conformance scenario timed out")
    end
  end

  defp apply_event(machine, fixture, event) do
    run_id = event["runId"] || fixture["runId"]
    activity_id = event["activityId"] || fixture["activityId"]
    observations_before = machine.observations

    {machine, accepted, commands} =
      cond do
        terminal?(machine.state) ->
          {machine, false, []}

        true ->
          machine =
            if is_nil(machine.run_id) do
              %{machine | run_id: run_id, activity_id: activity_id}
            else
              machine
            end

          cond do
            machine.run_id != run_id or machine.activity_id != activity_id ->
              {machine, false, []}

            MapSet.member?(machine.seen, event["eventId"]) ->
              {machine, false, []}

            true ->
              machine = %{machine | seen: MapSet.put(machine.seen, event["eventId"])}
              {next, commands} = transition(machine, event)
              {next, true, commands}
          end
      end

    trace_entry = %{
      "eventId" => event["eventId"],
      "accepted" => accepted,
      "state" => machine.state,
      "commands" => commands,
      "observationDelta" => machine.observations - observations_before
    }

    {machine, trace_entry}
  end

  defp transition(machine, %{"type" => "participant_joined", "participantId" => participant_id}) do
    cond do
      participant_id in machine.participants ->
        {machine, []}

      length(machine.participants) == 0 ->
        {%{machine | participants: [participant_id], state: "WAITING"}, []}

      length(machine.participants) == 1 ->
        {%{machine | participants: machine.participants ++ [participant_id], state: "READY"}, ["START_ACTIVITY"]}

      true ->
        {machine, []}
    end
  end

  defp transition(machine, %{"type" => "participant_left", "participantId" => participant_id}) do
    if machine.state == "RUNNING" and participant_id in machine.participants do
      {%{machine | state: "ENDING"}, []}
    else
      {machine, []}
    end
  end

  defp transition(machine, %{"type" => "activity_started"}) do
    if machine.state == "READY", do: {%{machine | state: "RUNNING"}, []}, else: {machine, []}
  end

  defp transition(machine, %{"type" => "observation"}) do
    if machine.state == "RUNNING" do
      {%{machine | observations: machine.observations + 1}, []}
    else
      {machine, []}
    end
  end

  defp transition(machine, %{"type" => "activity_ended"}) do
    if machine.state in ["RUNNING", "ENDING"] do
      {%{machine | state: "COMPLETED"}, []}
    else
      {machine, []}
    end
  end

  defp transition(machine, %{"type" => "transport_failure"}) do
    {%{machine | state: "FAILED"}, []}
  end

  defp transition(_machine, event) do
    raise ArgumentError, "unknown Omni conformance event type: #{inspect(event["type"])}"
  end

  defp terminal?(state), do: state in ["COMPLETED", "FAILED"]
end
