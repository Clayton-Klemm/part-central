"""Executable relational-algebra examples accompanying DATABASE_PROOF.md.

This proves implications of explicitly declared functional dependencies, not
optimal performance or the truth of arbitrary business assumptions.
"""
import json


def closure(attributes, dependencies):
    result = set(attributes)
    while True:
        expanded = result | set().union(*(set(right) for left, right in dependencies if set(left) <= result))
        if expanded == result:
            return result
        result = expanded


def main():
    dependencies = [({"part_id"}, {"part_number", "part_name"}),
                    ({"revision_id"}, {"part_id", "revision_code", "material"}),
                    ({"operation_id"}, {"revision_id", "operation_code"}),
                    ({"feature_id"}, {"operation_id", "feature_number", "nominal", "tolerances"})]
    all_attributes = set().union(*(left | right for left, right in dependencies))
    assert closure({"feature_id"}, dependencies) == all_attributes
    # A decomposition is lossless when its intersection determines one side.
    joins = []
    relations = [({"feature_id", "operation_id", "feature_number", "nominal", "tolerances"}, {"operation_id", "revision_id", "operation_code"}),
                 ({"operation_id", "revision_id", "operation_code"}, {"revision_id", "part_id", "revision_code", "material"}),
                 ({"revision_id", "part_id", "revision_code", "material"}, {"part_id", "part_number", "part_name"})]
    for left, right in relations:
        intersection = left & right
        assert right <= closure(intersection, dependencies)
        joins.append({"intersection": sorted(intersection), "determines": sorted(right), "lossless": True})
    # Exact decimal integer lattice: 14 total digits, 6 fractional digits.
    nominal, minus, plus = 12_500_000, 25_000, 25_000
    assert nominal - minus <= 12_475_000 <= nominal + plus
    assert not nominal - minus <= 12_474_999 <= nominal + plus
    samples, features, requirement_bytes, event_bytes = 10000, 20, 256, 64
    repeated = samples * features * (requirement_bytes + event_bytes)
    separated = features * requirement_bytes + samples * features * event_bytes
    saved = (samples - 1) * features * requirement_bytes
    assert repeated - separated == saved == 51_194_880
    # State proof for optimistic concurrency under one serialized run lock.
    initial_sequence = 7
    successes, conflicts = 0, 0
    for expected in [7, 7]:
        if expected == initial_sequence:
            initial_sequence += 1
            successes += 1
        else:
            conflicts += 1
    assert (successes, conflicts, initial_sequence) == (1, 1, 8)
    print(json.dumps({"passed": True, "assumptions": "Explicit FD set and serialized run-row lock; live schema/transactions are tested separately.",
                      "losslessJoins": joins, "illustrativeBytesSaved": saved,
                      "serializedRace": {"successfulAppends": successes, "staleConflicts": conflicts}}, indent=2))


if __name__ == "__main__":
    main()
