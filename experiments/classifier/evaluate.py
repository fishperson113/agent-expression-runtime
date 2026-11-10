"""Frozen-policy synthetic evaluation; no remote inference or renderer effects."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, f1_score

LABELS = ['observe', 'attend', 'acknowledge', 'playful', 'abstain']
REACT = {'attend', 'acknowledge', 'playful'}


def flatten(value, prefix=''):
    result = {}
    for key, item in value.items():
        name = f'{prefix}.{key}' if prefix else key
        if isinstance(item, dict):
            result.update(flatten(item, name))
        elif item is None:
            result[name] = 'unknown'
        elif isinstance(item, (str, int, float, bool)):
            result[name] = item
        else:
            result[name] = json.dumps(item, sort_keys=True)
    return result


def choose(scores, gated=False):
    ordered = sorted(scores, key=scores.get, reverse=True)
    if gated and (scores[ordered[0]] < 0.7 or scores[ordered[0]] - scores[ordered[1]] < 0.15):
        return 'abstain'
    return ordered[0]


def metrics(rows, predictions):
    expected = [row['acceptableLabels'][0] for row in rows]
    good = [pred in row['acceptableLabels'] for row, pred in zip(rows, predictions)]
    positives = [bool(set(row['acceptableLabels']) & REACT) for row in rows]
    negative = [not pos and not row.get('mustAbstain', False) for pos, row in zip(positives, rows)]
    tp = sum(pos and pred in REACT for pos, pred in zip(positives, predictions))
    fp = sum(neg and pred in REACT for neg, pred in zip(negative, predictions))
    predicted = sum(pred in REACT for pred in predictions)
    covered = [i for i, pred in enumerate(predictions) if pred != 'abstain']
    required = [i for i, row in enumerate(rows) if row.get('mustAbstain', False)]
    return dict(n=len(rows), acceptableAccuracy=np.mean(good).item(),
                scenarioFamilyCount=len({row['scenarioFamily'] for row in rows}),
                canonicalMacroF1=f1_score(expected, predictions, labels=LABELS, average='macro', zero_division=0),
                reactPrecision=tp / predicted if predicted else None,
                reactRecall=tp / sum(positives) if sum(positives) else None,
                falsePositiveRate=fp / sum(negative) if sum(negative) else None,
                falsePositiveCount=fp, negativeCount=sum(negative),
                coverage=len(covered) / len(rows),
                selectiveAccuracy=sum(good[i] for i in covered) / len(covered) if covered else None,
                mustAbstainRecall=sum(predictions[i] == 'abstain' for i in required) / len(required) if required else None,
                unsafeReactOnMustAbstain=sum(predictions[i] in REACT for i in required),
                unsafeReactOnMustAbstainRate=sum(predictions[i] in REACT for i in required) / len(required) if required else None,
                confusionLabels=LABELS, canonicalConfusion=confusion_matrix(expected, predictions, labels=LABELS).tolist())


def load_predictions(path, rows):
    records = [json.loads(line) for line in path.read_text().splitlines() if line]
    outputs = {row['id']: row for row in records}
    if len({row['id'] for row in rows}) != len(rows) or len(outputs) != len(records) or set(outputs) != {row['id'] for row in rows}:
        raise ValueError('prediction IDs must exactly cover dataset without duplicates')
    for record in records:
        scores = record['scores']
        if set(scores) != set(LABELS) or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not np.isfinite(v) or not 0 <= v <= 1 for v in scores.values()):
            raise ValueError('invalid five-label scores')
        if abs(sum(scores.values()) - 1) > 1e-5:
            raise ValueError('scores must be explicitly normalized')
    return outputs


def features(row):
    return flatten({key: value for key, value in row['state'].items() if key != 'note'})


def paired_metrics(rows, predictions):
    pairs = {}
    for row, prediction in zip(rows, predictions):
        if 'pairId' in row:
            pairs.setdefault(row['pairId'], []).append((row, prediction))
    result = {}
    for key, pair in pairs.items():
        if len(pair) != 2:
            raise ValueError('Expected exactly two rows per counterfactual pair')
        (first, left), (second, right) = pair
        same = left == right
        result[key] = {'labels': [left, right], 'bothAcceptable': left in first['acceptableLabels'] and right in second['acceptableLabels'],
                       'relationCorrect': same == (first['expectedRelation'] == 'invariant')}
    return result


def overlap_audit(rows):
    canonical = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'))
    trained = {canonical(features(row)): row['id'] for row in rows if row['split'] == 'train'}
    full = {canonical(row['state']): row['id'] for row in rows if row['split'] == 'train'}
    overlaps = [{'id': row['id'], 'split': row['split'], 'trainId': trained[canonical(features(row))],
                 'fullStateAlsoIdentical': canonical(row['state']) in full}
                for row in rows if row['split'] != 'train' and canonical(features(row)) in trained]
    return {'method': 'Exact projected structured features, excluding note; preserves original cohorts.',
            'overlaps': overlaps, 'holdoutOverlapCount': sum(row['split'] == 'holdout' for row in overlaps),
            'warning': 'Family-name separation alone did not isolate baseline features. Deduplicated subset is post hoc, not fresh validation.'}


def report_group(report, split, group, outputs, baselines, model_label):
    variants = {'always_observe': ['observe'] * len(group)}
    for name, scores in [('logistic', baselines), (model_label, {key: value['scores'] for key, value in outputs.items()})]:
        for gated in [False, True]:
            variants[name + ('_gated' if gated else '_raw')] = [choose(scores[row['id']], gated) for row in group]
    report['results'][split] = {name: metrics(group, preds) for name, preds in variants.items()}
    if any('pairId' in row for row in group):
        report['pairedProbes'] = {name: paired_metrics(group, preds) for name, preds in variants.items()}
    for slice_name in sorted({s for row in group for s in row.get('slices', [])}):
        indices = [i for i, row in enumerate(group) if slice_name in row.get('slices', [])]
        report['results'][split + '/' + slice_name] = {name: metrics([group[i] for i in indices], [preds[i] for i in indices]) for name, preds in variants.items()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('dataset', type=Path)
    parser.add_argument('predictions', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--model-label', default='laya', choices=['laya', 'gliner', 'candidate'])
    args = parser.parse_args()
    rows = [json.loads(line) for line in args.dataset.read_text().splitlines() if line]
    outputs = load_predictions(args.predictions, rows)
    train = [row for row in rows if row['split'] == 'train']
    vectorizer = DictVectorizer()
    classifier = LogisticRegression(max_iter=2000, random_state=7, class_weight='balanced')
    classifier.fit(vectorizer.fit_transform([features(row) for row in train]),
                   [row['acceptableLabels'][0] for row in train])
    probabilities = classifier.predict_proba(vectorizer.transform([features(row) for row in rows]))
    baselines = {row['id']: dict(zip(classifier.classes_, scores)) for row, scores in zip(rows, probabilities)}
    report = {'datasetSha256': hashlib.sha256(args.dataset.read_bytes()).hexdigest(),
              'candidateLabel': args.model_label,
              'predictionsSha256': hashlib.sha256(args.predictions.read_bytes()).hexdigest(),
              'gate': {'minimumTopScore': 0.7, 'minimumMargin': 0.15, 'calibrated': False},
              'notes': ['Canonical macro F1 uses first acceptable label; acceptable accuracy permits all declared labels.',
                        'Macro F1 always includes all five labels, including absent labels in individual slices.',
                        'Logistic baseline uses structured fields only; natural-language note excluded.',
                        'Synthetic policy labels do not establish real-world gesture or naturalness quality.'], 'results': {}}
    report['featureOverlapAudit'] = overlap_audit(rows)
    for split in sorted({row['split'] for row in rows} - {'train'}):
        report_group(report, split, [row for row in rows if row['split'] == split], outputs, baselines, args.model_label)
    overlapping = {row['id'] for row in report['featureOverlapAudit']['overlaps']}
    clean = [row for row in rows if row['split'] == 'holdout' and row['id'] not in overlapping]
    if clean:
        report_group(report, 'holdout_nonoverlap_posthoc', clean, outputs, baselines, args.model_label)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['results'].get('holdout', {}), indent=2))


if __name__ == '__main__':
    main()
