---
name: mockito-strictness-policy
description: Apply the repository's Mockito strictness and lifecycle-method policy when reviewing or refactoring tests. Use when the user asks about LENIENT Mockito usage, strict stubbing, empty lifecycle methods, or test hygiene policy.
---

Apply this policy when writing, reviewing, or refactoring tests in this repository.

## Default rule
Use strict Mockito by default:
- prefer `@ExtendWith(MockitoExtension.class)`
- do not add class-level `@MockitoSettings(strictness = Strictness.LENIENT)` unless justified
- keep stubbing local to the scenario whenever practical

## What to do when strict Mockito fails
Follow this order:

1. **Remove dead stubs**
   - Delete stubbing that the test does not actually consume.
   - Treat `UnnecessaryStubbingException` as a likely signal of stale or over-broad setup.

2. **Move stubs closer to the test**
   - Prefer test-local stubbing over broad `@BeforeEach` fixture setup.
   - Shared lifecycle setup should usually only construct the subject under test or provide truly universal defaults.

3. **Split setup into narrow helpers**
   - Extract scenario-focused helpers instead of large generic setup methods.
   - Prefer helpers like `givenExistingMember()` over a giant `setUp()` that configures many unrelated mocks.

4. **Use targeted `Mockito.lenient()` only for a specific stub**
   - This is allowed when one shared default materially improves readability but is not used by every test.
   - Prefer:
     - `Mockito.lenient().when(clock.now()).thenReturn(fixedTime);`
   - Avoid sprinkling leniency widely without justification.

5. **Use class-level LENIENT only as a last resort**
   - Allowed only when the test class is genuinely branch-heavy and orchestration-heavy.
   - Use it when strict mode would create excessive duplication with little readability gain.
   - If you keep class-level leniency, add a short comment explaining why.

## When class-level LENIENT is allowed
Only if all of the following are true:
- the class covers many related branches of one orchestration-heavy unit
- shared setup materially improves readability
- repeated local stubbing would create excessive duplication/noise
- targeted `Mockito.lenient()` would still leave many scattered lenient stubs
- the class has already been considered for refactoring and leniency is still the best tradeoff

## When class-level LENIENT is not allowed
Do not use class-level leniency for:
- small unit tests
- MVC/controller tests by default
- repository / JDBC slice tests by default
- new tests without prior strict-mode attempts
- cases where leniency is just masking a giant fixture bag

## Empty lifecycle method policy
Remove all empty lifecycle methods immediately:
- `@BeforeEach`
- `@BeforeAll`
- `@AfterEach`
- `@AfterAll`

Also remove placeholder lifecycle methods that no longer do meaningful work.

Lifecycle methods that remain should:
- perform real setup/cleanup
- stay short
- improve readability
- avoid becoming shared mutable fixture bags

## Review checklist
When reviewing tests, ask:
1. Is strict Mockito used by default?
2. If not, is there a clear, local justification?
3. Could class-level leniency be replaced by deleting stubs, localizing setup, or a targeted `Mockito.lenient()`?
4. Are there any empty lifecycle methods?
5. Is the test in the right category/package for its scope?

## Heuristic by test type
- **Small business-logic unit tests**: strict only
- **Branch-heavy orchestration services**: strict by default; targeted leniency allowed; class-level leniency only with justification
- **MVC/controller tests**: strict only unless there is an exceptional reason
- **DB integration tests**: minimize Mockito; do not use leniency as a substitute for the correct slice
- **HTTP boundary tests**: strict by default; targeted leniency only if a shared default is genuinely useful

## Short policy text
Use Mockito strict mode by default. Remove unused stubs first, then localize setup to the tests that need it. If a shared default stub genuinely improves readability, prefer targeted `Mockito.lenient()` on that specific stub. Class-level `@MockitoSettings(strictness = Strictness.LENIENT)` is a last resort and must be justified by branch-heavy orchestration tests where strict mode would create excessive duplication with little clarity benefit. Empty lifecycle methods are not allowed and should be removed immediately.
