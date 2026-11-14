import {expect,it} from 'vitest';
import {parseCompactPresentationRecord} from '../integrations/presentation-compact.mjs';
import {validateAnnotations} from '../src/live/presentation-annotations';
const geometry={base:'replace',parts:[['e','node',0,0,0,.2,.2,.2]]};
it.each([{labels:[{text:'DE',x:.4,y:.3}]},{arrows:[{from:[.2,.2],to:[.7,.7]}]},{}])('feeds compact annotations into actual browser contract without rejection: %o',annotations=>{
 const record=parseCompactPresentationRecord(JSON.stringify({...geometry,annotations}));
 expect(()=>validateAnnotations(record.annotations)).not.toThrow();
 expect(validateAnnotations(record.annotations)).toEqual({labels:annotations.labels??[],arrows:annotations.arrows??[]});
});
