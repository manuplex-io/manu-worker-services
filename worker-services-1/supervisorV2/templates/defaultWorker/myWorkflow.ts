// /myWorkflow.ts

// //standard workflows

// import { proxyActivities } from '@temporalio/workflow';
// import type * as activities from './myActivity';

// const { addTwoNumbers, multiplyTwoNumbers } = proxyActivities<typeof activities>({
//     startToCloseTimeout: '1 minute',
// });

// export async function simpleMathWorkflow(a: number, b: number, c: number): Promise<number> {
//     const sum = await addTwoNumbers(a, b);
//     const result = await multiplyTwoNumbers(sum, c);
//     return result;
// }
