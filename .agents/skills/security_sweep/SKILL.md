---
name: Security Sweep
description: Use after authentication changes, API changes, data handling changes, dependency updates, infrastructure changes, or any request for a security review to scan the codebase for vulnerabilities, insecure defaults, validation gaps, secret exposure, permission issues, injection risks, and unsafe data flows, then verify the strongest available security-relevant checks.
---

# Security Sweep

Use this skill when the task is specifically about security or when recent changes could have security impact.

## Focus areas

- Authentication, authorization, session handling, and permission boundaries.
- Input validation, output encoding, and unsafe deserialization.
- SQL, command, template, HTML, or path injection risks.
- Secret handling, tokens, env usage, and accidental credential exposure.
- File access, storage permissions, CORS, CSRF, SSRF, and open redirect risks.
- Dependency or configuration choices that weaken security posture.

## Workflow

1. Identify trust boundaries, user-controlled inputs, privileged actions, and external integrations.
2. Trace data flow from entrypoint to storage, rendering, and side effects.
3. Search for dangerous sinks and insecure patterns with `rg`.
4. Run the repo's security-relevant checks if present, such as tests, lint rules, typecheck, dependency audit, or framework-specific analyzers.
5. Fix concrete vulnerabilities or document why a suspected issue is not exploitable.
6. Re-run relevant checks and summarize residual risk.

## Review rules

- Prefer concrete exploitability over theoretical warnings.
- Treat missing validation on privileged paths as high risk.
- Do not claim a vulnerability without naming the input, sink, and impact.
- If a control relies on the client alone, treat it as insufficient until server-side enforcement is confirmed.
- If no automated security tooling exists, state that limitation explicitly.

## Useful commands

```bash
rg "eval\\(|innerHTML|dangerouslySetInnerHTML|exec\\(|spawn\\(|child_process|SELECT |INSERT |UPDATE |DELETE |rawQuery|raw\\("
rg "process\\.env|API_KEY|SECRET|TOKEN|PASSWORD"
rg "auth|authorize|permission|role|csrf|cors|redirect"
```

Adapt searches to the stack in the repo.

## Output standard

- Confirmed vulnerabilities fixed or not found
- Security checks run
- High-risk assumptions or unresolved gaps
