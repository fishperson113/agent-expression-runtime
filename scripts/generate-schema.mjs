import { writeFileSync, mkdirSync } from 'node:fs';
const integer = (maximum = 10000) => ({ type: 'integer', minimum: 0, maximum });
const number = (maximum = 1) => ({ type: 'number', minimum: 0, maximum });
const str = { type: 'string', minLength: 1, maxLength: 128 };
const obj = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const constant = (value) => ({ const: value });
const param = obj({ type: constant('param'), name: str });
const templatize = (s) => ({ anyOf: [s, { $ref: '#/$defs/param' }] });
const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Agent Expression Runtime wire protocol v1',
  oneOf: [],
  $defs: { param },
};
for (const template of [false, true]) {
  const ref = template ? 'template' : 'node',
    v = (s) => (template ? templatize(s) : s);
  const duration = { durationMs: v(integer()), easing: v({ enum: ['linear', 'smoothstep'] }) };
  const leaf = (type, props, required) =>
    obj({ type: constant(type), ...props }, ['type', ...required]);
  schema.$defs[ref] = {
    oneOf: [
      leaf('morph', { target: v({ enum: ['sphere', 'ring', 'wave', 'cloud'] }), ...duration }, [
        'target',
        'durationMs',
      ]),
      leaf(
        'flow',
        {
          field: v({ enum: ['orbit', 'turbulence', 'pulse'] }),
          strength: v(number()),
          ...duration,
        },
        ['field', 'strength', 'durationMs'],
      ),
      {
        ...leaf(
          'style',
          {
            color: v({ type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }),
            brightness: v(number()),
            pointSize: v(number(8)),
            dispersion: v(number()),
            ...duration,
          },
          ['durationMs'],
        ),
        anyOf: ['color', 'brightness', 'pointSize', 'dispersion'].map((p) => ({ required: [p] })),
      },
      leaf('wait', { durationMs: v(integer()) }, ['durationMs']),
      ...['sequence', 'parallel'].map((type) =>
        leaf(
          type,
          {
            children: {
              type: 'array',
              minItems: 1,
              maxItems: 128,
              items: { $ref: `#/$defs/${ref}` },
            },
          },
          ['children'],
        ),
      ),
      leaf(
        'call',
        {
          name: str,
          revision: integer(Number.MAX_SAFE_INTEGER),
          args: {
            type: 'object',
            maxProperties: 8,
            additionalProperties: template
              ? { anyOf: [{ type: ['string', 'number'] }, { $ref: '#/$defs/param' }] }
              : { type: ['string', 'number'] },
          },
        },
        ['name', 'revision', 'args'],
      ),
    ],
  };
}
const base = {
  v: constant(1),
  epoch: str,
  seq: integer(Number.MAX_SAFE_INTEGER),
  ttlMs: integer(5000),
};
schema.oneOf = [
  obj(
    {
      ...base,
      kind: constant('program'),
      track: constant('body'),
      policy: { enum: ['append', 'replace'] },
      body: { $ref: '#/$defs/node' },
    },
    ['v', 'epoch', 'seq', 'kind', 'track', 'policy', 'body'],
  ),
  obj(
    {
      ...base,
      kind: constant('state'),
      body: {
        ...obj(
          {
            brightness: number(),
            pointSize: number(8),
            dispersion: number(),
            durationMs: integer(),
            easing: { enum: ['linear', 'smoothstep'] },
          },
          [],
        ),
        anyOf: ['brightness', 'pointSize', 'dispersion'].map((p) => ({ required: [p] })),
      },
    },
    ['v', 'epoch', 'seq', 'kind', 'body'],
  ),
  obj(
    {
      ...base,
      kind: constant('define'),
      body: obj({
        name: str,
        revision: integer(Number.MAX_SAFE_INTEGER),
        params: {
          type: 'object',
          maxProperties: 8,
          propertyNames: { pattern: '^[a-zA-Z][\\w]{0,63}$' },
          additionalProperties: { enum: ['number', 'string'] },
        },
        body: { $ref: '#/$defs/template' },
      }),
    },
    ['v', 'epoch', 'seq', 'kind', 'body'],
  ),
];
mkdirSync('src/contracts', { recursive: true });
writeFileSync('src/contracts/protocol.schema.json', JSON.stringify(schema, null, 2) + '\n');
