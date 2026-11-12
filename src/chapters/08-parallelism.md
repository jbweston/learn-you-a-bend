---
chapter: 8
title: "8. Two elves, two independent jobs"
slug: 8-two-elves-two-independent-jobs
source: "08-parallelism.bend"
part: "Resources, effects, and proofs"
---

Run [08-parallelism.bend](../08-parallelism.bend). Expect **1024**.

```bend
def pow2(+n: Nat) -> U32:
  match n:
    case 0n:
      1
    case 1n+p:
      a b = pow2(p) pow2(p)
      (a + b : U32)
```

Two results double the previous answer. At zero, the answer is one. After ten doublings, it is 1024.

The unusual line is the point:

```bend
      a b = pow2(p) pow2(p)
```

This is a **parallel call**, a binary fork followed by a join. Each recursive job has the same size. Since `n` is reusable, matching it gives reusable fields, allowing both jobs to receive `p`.

This is intentionally a toy workload: calculating powers of two this way repeats lots of work. Parallelism does not rescue a poor algorithm. We use it to see the fork-join structure, not to recommend a production exponentiation function.

> **Haskell companion:** you might expose parallel pure work with strategies from `Control.Parallel.Strategies`. Two ordinary Haskell `let` bindings do not by themselves request multicore scheduling. Likewise, not every pair of ordinary Bend calls is the explicit parallel form above. Think “fork independent pure calculations”, not “start two IO threads”.

### Balance matters

Bend's current scheduler is binary fork-join, without moving tasks between cores after assigning them. Uneven work can leave one worker waiting while the other struggles with a mountain of biscuits. Aim for independent jobs of roughly equal cost.

The JavaScript target runs these calls sequentially. The native target uses CPU parallelism; a call spelled `pow2!(10n)` requests GPU execution for it and its nested parallel calls. GPU compilation needs the platform toolchain; machines without a GPU can run those calls on the CPU. This tutorial deliberately avoids `!` so you do not need a GPU setup.

To explore the native runtime explicitly, compile outside the tutorial's source files:

```sh
bend src/08-parallelism.bend -o /tmp/bend-tutorial-parallel
/tmp/bend-tutorial-parallel --threads 2
```

Small examples can spend more time scheduling than calculating. Do not infer a speedup from this one! Read `bend guide shaders` before building a serious parallel or GPU workload.

**Try it:** use `5n`; expect **32**. Keep the counters small. Contrast this branching computation with chapter 4's single recursive chain: where would independent work come from in each?
