export type UserRequestSourceV2=Readonly<{key:string;documentId:string;threadId:string;generation:number;turnId:string;messageId:string;text:string;publicContext:string;sourceVersion:number;sourceAt:number;deadline:number;publicRevision:number}>;
export class UserRequestLeaseV2 {
 constructor(now?:()=>number); current:UserRequestSourceV2|null;
 enable(documentId:unknown,snapshot:unknown):boolean;
 observe(documentId:unknown,snapshot:unknown):UserRequestSourceV2|null;
 deferenceSource(documentId:unknown,snapshot:unknown):UserRequestSourceV2|null;
 retire():void; tombstone(version:number):boolean;
}
