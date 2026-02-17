# Verification Guide

Before marking any task complete, you MUST verify your work.

## The Verification Process

1. **Re-read the task context**: What did you originally commit to do?
2. **Check acceptance criteria**: Does your implementation satisfy the "Done when" conditions?
3. **Run relevant tests**: Execute the test suite and document results
4. **Test manually**: Actually try the feature/change yourself
5. **Compare with requirements**: Does what you built match what was asked?

## Strong vs Weak Verification

### Strong Verification Examples
- "All 60 tests passing, build successful"
- "All 69 tests passing (4 new tests for middleware edge cases)"
- "Manually tested with valid/invalid/expired tokens - all cases work"

### Weak Verification (Avoid)
- "Should work now" - "should" means not verified
- "Made the changes" - no evidence it works
- "Added tests" - did the tests pass? What's the count?
- "Done" - done how? prove it

## Cross-Reference Checklist

- [ ] Task description requirements met
- [ ] Context "Done when" criteria satisfied
- [ ] Tests passing (document count: "All X tests passing")
- [ ] Build succeeds (if applicable)
- [ ] Manual testing done (describe what you tested)
- [ ] No regressions introduced
- [ ] Edge cases considered
- [ ] Follow-up work identified (created new tasks if needed)

**If you can't check all applicable boxes, the task isn't done yet.**

## When Verification Fails

1. **Don't complete the task** - it's not done
2. **Document what failed** in task context
3. **Fix the issues** before completing
4. **Re-verify** after fixes
