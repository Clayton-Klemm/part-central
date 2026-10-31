import { describe, expect, it } from 'vitest';
import data from '../../data/demo.json';
import type { Part } from '../types';
import { diagramSvg, operationSvg } from '../../scripts/example_visual_templates';

describe('complete local synthetic drawings', () => {
  it('renders a complete family drawing even when the live part has no reference selected yet', () => {
    const part = structuredClone(data.parts.find(part => part.number === 'DF-5200')) as Part;
    part.references = null;
    part.operation.sketchId = null;
    part.features[0].nominal = 68.010;
    const svg = operationSvg(part);
    expect(svg).toContain('viewBox="0 0 1120 690"');
    expect(svg).toContain('68.010 mm');
    expect(svg).toContain('INSPECTION CHARACTERISTICS');
    expect(svg).not.toContain('lucide-book-open');
    for (const feature of part.features) expect(svg).toContain(feature.label);
  });
  it('renders the correct family sketch and companion diagram for every active starter', () => {
    for (const part of data.parts as Part[]) {
      const sketch = operationSvg(part);
      const diagram = diagramSvg(part);
      expect(sketch).toContain(part.number);
      expect(sketch).toContain(`REV ${part.revision.code}`);
      expect(diagram).toContain(`${part.number} / MEASUREMENT SETUP`);
      expect(diagram).toContain('NOT A CONTROLLED MANUFACTURING DRAWING');
      if (part.revision.geometryFamily !== 'dog-clutch') expect(sketch).not.toContain('DOG PROFILE');
    }
  });
  it('escapes administrator-entered labels in generated SVG text', () => {
    const part = structuredClone(data.parts.find(part => part.number === 'MF-6100')) as Part;
    part.features[0].label = 'Thread <12> & entry';
    const diagram = diagramSvg(part);
    expect(diagram).toContain('Thread &lt;12&gt; &amp; entry');
    expect(diagram).not.toContain('Thread <12> & entry');
  });
});
