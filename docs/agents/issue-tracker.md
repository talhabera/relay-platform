# Issue tracker: Plane

Plane project: RELAY

Tickets for this repo are work items in Plane project RELAY (keys like RELAY-12); phases are Plane
modules. Use `ag-plane` from the agentration plugin for every tracker operation:

- Publish: `ag-plane create --title T --body-file F --status needs-triage`
- Fetch: `ag-plane show RELAY-N`
- Claim: `ag-plane set-status RELAY-N claimed`
- Resolve: `ag-plane set-status RELAY-N resolved`
- Comment: `ag-plane comment RELAY-N --body-file F`
- Phases: `ag-plane modules`, `ag-plane module show <name>`
