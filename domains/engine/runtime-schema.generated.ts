/* eslint-disable */
// @ts-nocheck
// 由 scripts/build/build-runtime-schemas.mjs 生成；请勿手动编辑。
import __helper0 from 'ajv/dist/runtime/ucs2length.js';
const validator0 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    additionalProperties: false,
    properties: {
      action: { enum: ['local', 'push', 'pr'] },
      commit: { pattern: '^[0-9a-f]{40}(?:[0-9a-f]{24})?$', type: 'string' },
      prUrl: { minLength: 1, type: 'string' },
      remote: { minLength: 1, type: 'string' },
      targetBranch: { minLength: 1, type: 'string' },
    },
    required: ['action', 'targetBranch', 'commit'],
    type: 'object',
  };
  const pattern0 = new RegExp('^[0-9a-f]{40}(?:[0-9a-f]{24})?$', 'u');
  const func2 = __helper0.default ?? __helper0;
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.action === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'action' },
          message: "must have required property '" + 'action' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      if (data.targetBranch === undefined) {
        const err1 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'targetBranch' },
          message: "must have required property '" + 'targetBranch' + "'",
        };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
      if (data.commit === undefined) {
        const err2 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'commit' },
          message: "must have required property '" + 'commit' + "'",
        };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      for (const key0 in data) {
        if (!(
          key0 === 'action' ||
          key0 === 'commit' ||
          key0 === 'prUrl' ||
          key0 === 'remote' ||
          key0 === 'targetBranch'
        )) {
          const err3 = {
            instancePath,
            schemaPath: '#/additionalProperties',
            keyword: 'additionalProperties',
            params: { additionalProperty: key0 },
            message: 'must NOT have additional properties',
          };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      }
      if (data.action !== undefined) {
        let data0 = data.action;
        if (!(data0 === 'local' || data0 === 'push' || data0 === 'pr')) {
          const err4 = {
            instancePath: instancePath + '/action',
            schemaPath: '#/properties/action/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.action.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      }
      if (data.commit !== undefined) {
        let data1 = data.commit;
        if (typeof data1 === 'string') {
          if (!pattern0.test(data1)) {
            const err5 = {
              instancePath: instancePath + '/commit',
              schemaPath: '#/properties/commit/pattern',
              keyword: 'pattern',
              params: { pattern: '^[0-9a-f]{40}(?:[0-9a-f]{24})?$' },
              message: 'must match pattern "' + '^[0-9a-f]{40}(?:[0-9a-f]{24})?$' + '"',
            };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        } else {
          const err6 = {
            instancePath: instancePath + '/commit',
            schemaPath: '#/properties/commit/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      }
      if (data.prUrl !== undefined) {
        let data2 = data.prUrl;
        if (typeof data2 === 'string') {
          if (func2(data2) < 1) {
            const err7 = {
              instancePath: instancePath + '/prUrl',
              schemaPath: '#/properties/prUrl/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err7];
            } else {
              vErrors.push(err7);
            }
            errors++;
          }
        } else {
          const err8 = {
            instancePath: instancePath + '/prUrl',
            schemaPath: '#/properties/prUrl/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      }
      if (data.remote !== undefined) {
        let data3 = data.remote;
        if (typeof data3 === 'string') {
          if (func2(data3) < 1) {
            const err9 = {
              instancePath: instancePath + '/remote',
              schemaPath: '#/properties/remote/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        } else {
          const err10 = {
            instancePath: instancePath + '/remote',
            schemaPath: '#/properties/remote/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      }
      if (data.targetBranch !== undefined) {
        let data4 = data.targetBranch;
        if (typeof data4 === 'string') {
          if (func2(data4) < 1) {
            const err11 = {
              instancePath: instancePath + '/targetBranch',
              schemaPath: '#/properties/targetBranch/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err11];
            } else {
              vErrors.push(err11);
            }
            errors++;
          }
        } else {
          const err12 = {
            instancePath: instancePath + '/targetBranch',
            schemaPath: '#/properties/targetBranch/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
      }
    } else {
      const err13 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err13];
      } else {
        vErrors.push(err13);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator1 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    additionalProperties: false,
    properties: {
      archiveConfirmation: { enum: [null, 'pending', 'confirmed'] },
      archived: { type: 'boolean' },
      autoTransition: { type: ['boolean', 'null'] },
      baseRef: { type: ['string', 'null'] },
      boundBranch: { type: ['string', 'null'] },
      branchStatus: { enum: [null, 'pending', 'handled'] },
      buildMode: {
        enum: [null, 'subagent-driven-development', 'executing-plans', 'direct', 'autonomous'],
      },
      buildPause: { enum: [null, 'plan-ready'] },
      checkEpoch: { minimum: 0, type: 'integer' },
      classicMigration: { enum: [null, 1] },
      classicProfile: { enum: [null, 'full', 'hotfix', 'tweak'] },
      contextCompression: { enum: [null, 'off', 'beta'] },
      createdAt: { type: ['string', 'null'] },
      designDoc: { type: ['string', 'null'] },
      directOverride: { type: ['boolean', 'null'] },
      handoffContext: { type: ['string', 'null'] },
      handoffHash: { anyOf: [{ type: 'null' }, { pattern: '^[a-f0-9]{64}$', type: 'string' }] },
      isolation: { enum: [null, 'current', 'branch', 'worktree'] },
      language: { enum: [null, 'en', 'zh-CN'] },
      phase: { enum: ['open', 'design', 'build', 'verify', 'archive'] },
      plan: { type: ['string', 'null'] },
      reviewMode: { enum: [null, 'off', 'standard', 'thorough'] },
      subagentDispatch: { enum: [null, 'confirmed'] },
      tddMode: { enum: [null, 'tdd', 'direct'] },
      verificationReport: { type: ['string', 'null'] },
      verifiedAt: { type: ['string', 'null'] },
      verifyFailures: { minimum: 0, type: 'integer' },
      verifyMode: { enum: [null, 'light', 'full'] },
      verifyResult: { enum: ['pending', 'pass', 'fail'] },
      workflow: { enum: ['full'] },
    },
    required: [
      'workflow',
      'language',
      'phase',
      'contextCompression',
      'buildMode',
      'buildPause',
      'subagentDispatch',
      'tddMode',
      'reviewMode',
      'isolation',
      'boundBranch',
      'verifyMode',
      'autoTransition',
      'baseRef',
      'designDoc',
      'plan',
      'verifyResult',
      'verifyFailures',
      'verificationReport',
      'branchStatus',
      'createdAt',
      'verifiedAt',
      'archiveConfirmation',
      'archived',
      'directOverride',
      'handoffContext',
      'handoffHash',
      'classicProfile',
      'classicMigration',
    ],
    type: 'object',
  };
  const func2 = Object.prototype.hasOwnProperty;
  const pattern0 = new RegExp('^[a-f0-9]{64}$', 'u');
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.workflow === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'workflow' },
          message: "must have required property '" + 'workflow' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      if (data.language === undefined) {
        const err1 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'language' },
          message: "must have required property '" + 'language' + "'",
        };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
      if (data.phase === undefined) {
        const err2 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'phase' },
          message: "must have required property '" + 'phase' + "'",
        };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      if (data.contextCompression === undefined) {
        const err3 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'contextCompression' },
          message: "must have required property '" + 'contextCompression' + "'",
        };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
      if (data.buildMode === undefined) {
        const err4 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'buildMode' },
          message: "must have required property '" + 'buildMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
      if (data.buildPause === undefined) {
        const err5 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'buildPause' },
          message: "must have required property '" + 'buildPause' + "'",
        };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
      if (data.subagentDispatch === undefined) {
        const err6 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'subagentDispatch' },
          message: "must have required property '" + 'subagentDispatch' + "'",
        };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
      if (data.tddMode === undefined) {
        const err7 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'tddMode' },
          message: "must have required property '" + 'tddMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
      if (data.reviewMode === undefined) {
        const err8 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'reviewMode' },
          message: "must have required property '" + 'reviewMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
      if (data.isolation === undefined) {
        const err9 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'isolation' },
          message: "must have required property '" + 'isolation' + "'",
        };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
      if (data.boundBranch === undefined) {
        const err10 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'boundBranch' },
          message: "must have required property '" + 'boundBranch' + "'",
        };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
      if (data.verifyMode === undefined) {
        const err11 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verifyMode' },
          message: "must have required property '" + 'verifyMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
      if (data.autoTransition === undefined) {
        const err12 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'autoTransition' },
          message: "must have required property '" + 'autoTransition' + "'",
        };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
      if (data.baseRef === undefined) {
        const err13 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'baseRef' },
          message: "must have required property '" + 'baseRef' + "'",
        };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
      if (data.designDoc === undefined) {
        const err14 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'designDoc' },
          message: "must have required property '" + 'designDoc' + "'",
        };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
      if (data.plan === undefined) {
        const err15 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'plan' },
          message: "must have required property '" + 'plan' + "'",
        };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
      if (data.verifyResult === undefined) {
        const err16 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verifyResult' },
          message: "must have required property '" + 'verifyResult' + "'",
        };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
      if (data.verifyFailures === undefined) {
        const err17 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verifyFailures' },
          message: "must have required property '" + 'verifyFailures' + "'",
        };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
      if (data.verificationReport === undefined) {
        const err18 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verificationReport' },
          message: "must have required property '" + 'verificationReport' + "'",
        };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
      if (data.branchStatus === undefined) {
        const err19 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'branchStatus' },
          message: "must have required property '" + 'branchStatus' + "'",
        };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
      if (data.createdAt === undefined) {
        const err20 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'createdAt' },
          message: "must have required property '" + 'createdAt' + "'",
        };
        if (vErrors === null) {
          vErrors = [err20];
        } else {
          vErrors.push(err20);
        }
        errors++;
      }
      if (data.verifiedAt === undefined) {
        const err21 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verifiedAt' },
          message: "must have required property '" + 'verifiedAt' + "'",
        };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
      if (data.archiveConfirmation === undefined) {
        const err22 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'archiveConfirmation' },
          message: "must have required property '" + 'archiveConfirmation' + "'",
        };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
      if (data.archived === undefined) {
        const err23 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'archived' },
          message: "must have required property '" + 'archived' + "'",
        };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
      if (data.directOverride === undefined) {
        const err24 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'directOverride' },
          message: "must have required property '" + 'directOverride' + "'",
        };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
      if (data.handoffContext === undefined) {
        const err25 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'handoffContext' },
          message: "must have required property '" + 'handoffContext' + "'",
        };
        if (vErrors === null) {
          vErrors = [err25];
        } else {
          vErrors.push(err25);
        }
        errors++;
      }
      if (data.handoffHash === undefined) {
        const err26 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'handoffHash' },
          message: "must have required property '" + 'handoffHash' + "'",
        };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
      if (data.classicProfile === undefined) {
        const err27 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'classicProfile' },
          message: "must have required property '" + 'classicProfile' + "'",
        };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
      if (data.classicMigration === undefined) {
        const err28 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'classicMigration' },
          message: "must have required property '" + 'classicMigration' + "'",
        };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
      for (const key0 in data) {
        if (!func2.call(schema11.properties, key0)) {
          const err29 = {
            instancePath,
            schemaPath: '#/additionalProperties',
            keyword: 'additionalProperties',
            params: { additionalProperty: key0 },
            message: 'must NOT have additional properties',
          };
          if (vErrors === null) {
            vErrors = [err29];
          } else {
            vErrors.push(err29);
          }
          errors++;
        }
      }
      if (data.archiveConfirmation !== undefined) {
        let data0 = data.archiveConfirmation;
        if (!(data0 === null || data0 === 'pending' || data0 === 'confirmed')) {
          const err30 = {
            instancePath: instancePath + '/archiveConfirmation',
            schemaPath: '#/properties/archiveConfirmation/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.archiveConfirmation.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
      }
      if (data.archived !== undefined) {
        if (typeof data.archived !== 'boolean') {
          const err31 = {
            instancePath: instancePath + '/archived',
            schemaPath: '#/properties/archived/type',
            keyword: 'type',
            params: { type: 'boolean' },
            message: 'must be boolean',
          };
          if (vErrors === null) {
            vErrors = [err31];
          } else {
            vErrors.push(err31);
          }
          errors++;
        }
      }
      if (data.autoTransition !== undefined) {
        let data2 = data.autoTransition;
        if (typeof data2 !== 'boolean' && data2 !== null) {
          const err32 = {
            instancePath: instancePath + '/autoTransition',
            schemaPath: '#/properties/autoTransition/type',
            keyword: 'type',
            params: { type: schema11.properties.autoTransition.type },
            message: 'must be boolean,null',
          };
          if (vErrors === null) {
            vErrors = [err32];
          } else {
            vErrors.push(err32);
          }
          errors++;
        }
      }
      if (data.baseRef !== undefined) {
        let data3 = data.baseRef;
        if (typeof data3 !== 'string' && data3 !== null) {
          const err33 = {
            instancePath: instancePath + '/baseRef',
            schemaPath: '#/properties/baseRef/type',
            keyword: 'type',
            params: { type: schema11.properties.baseRef.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err33];
          } else {
            vErrors.push(err33);
          }
          errors++;
        }
      }
      if (data.boundBranch !== undefined) {
        let data4 = data.boundBranch;
        if (typeof data4 !== 'string' && data4 !== null) {
          const err34 = {
            instancePath: instancePath + '/boundBranch',
            schemaPath: '#/properties/boundBranch/type',
            keyword: 'type',
            params: { type: schema11.properties.boundBranch.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err34];
          } else {
            vErrors.push(err34);
          }
          errors++;
        }
      }
      if (data.branchStatus !== undefined) {
        let data5 = data.branchStatus;
        if (!(data5 === null || data5 === 'pending' || data5 === 'handled')) {
          const err35 = {
            instancePath: instancePath + '/branchStatus',
            schemaPath: '#/properties/branchStatus/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.branchStatus.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err35];
          } else {
            vErrors.push(err35);
          }
          errors++;
        }
      }
      if (data.buildMode !== undefined) {
        let data6 = data.buildMode;
        if (!(
          data6 === null ||
          data6 === 'subagent-driven-development' ||
          data6 === 'executing-plans' ||
          data6 === 'direct' ||
          data6 === 'autonomous'
        )) {
          const err36 = {
            instancePath: instancePath + '/buildMode',
            schemaPath: '#/properties/buildMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.buildMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err36];
          } else {
            vErrors.push(err36);
          }
          errors++;
        }
      }
      if (data.buildPause !== undefined) {
        let data7 = data.buildPause;
        if (!(data7 === null || data7 === 'plan-ready')) {
          const err37 = {
            instancePath: instancePath + '/buildPause',
            schemaPath: '#/properties/buildPause/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.buildPause.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err37];
          } else {
            vErrors.push(err37);
          }
          errors++;
        }
      }
      if (data.checkEpoch !== undefined) {
        let data8 = data.checkEpoch;
        if (!(typeof data8 == 'number' && !(data8 % 1) && !isNaN(data8) && isFinite(data8))) {
          const err38 = {
            instancePath: instancePath + '/checkEpoch',
            schemaPath: '#/properties/checkEpoch/type',
            keyword: 'type',
            params: { type: 'integer' },
            message: 'must be integer',
          };
          if (vErrors === null) {
            vErrors = [err38];
          } else {
            vErrors.push(err38);
          }
          errors++;
        }
        if (typeof data8 == 'number' && isFinite(data8)) {
          if (data8 < 0 || isNaN(data8)) {
            const err39 = {
              instancePath: instancePath + '/checkEpoch',
              schemaPath: '#/properties/checkEpoch/minimum',
              keyword: 'minimum',
              params: { comparison: '>=', limit: 0 },
              message: 'must be >= 0',
            };
            if (vErrors === null) {
              vErrors = [err39];
            } else {
              vErrors.push(err39);
            }
            errors++;
          }
        }
      }
      if (data.classicMigration !== undefined) {
        let data9 = data.classicMigration;
        if (!(data9 === null || data9 === 1)) {
          const err40 = {
            instancePath: instancePath + '/classicMigration',
            schemaPath: '#/properties/classicMigration/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.classicMigration.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
      }
      if (data.classicProfile !== undefined) {
        let data10 = data.classicProfile;
        if (!(data10 === null || data10 === 'full' || data10 === 'hotfix' || data10 === 'tweak')) {
          const err41 = {
            instancePath: instancePath + '/classicProfile',
            schemaPath: '#/properties/classicProfile/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.classicProfile.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err41];
          } else {
            vErrors.push(err41);
          }
          errors++;
        }
      }
      if (data.contextCompression !== undefined) {
        let data11 = data.contextCompression;
        if (!(data11 === null || data11 === 'off' || data11 === 'beta')) {
          const err42 = {
            instancePath: instancePath + '/contextCompression',
            schemaPath: '#/properties/contextCompression/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.contextCompression.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err42];
          } else {
            vErrors.push(err42);
          }
          errors++;
        }
      }
      if (data.createdAt !== undefined) {
        let data12 = data.createdAt;
        if (typeof data12 !== 'string' && data12 !== null) {
          const err43 = {
            instancePath: instancePath + '/createdAt',
            schemaPath: '#/properties/createdAt/type',
            keyword: 'type',
            params: { type: schema11.properties.createdAt.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err43];
          } else {
            vErrors.push(err43);
          }
          errors++;
        }
      }
      if (data.designDoc !== undefined) {
        let data13 = data.designDoc;
        if (typeof data13 !== 'string' && data13 !== null) {
          const err44 = {
            instancePath: instancePath + '/designDoc',
            schemaPath: '#/properties/designDoc/type',
            keyword: 'type',
            params: { type: schema11.properties.designDoc.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err44];
          } else {
            vErrors.push(err44);
          }
          errors++;
        }
      }
      if (data.directOverride !== undefined) {
        let data14 = data.directOverride;
        if (typeof data14 !== 'boolean' && data14 !== null) {
          const err45 = {
            instancePath: instancePath + '/directOverride',
            schemaPath: '#/properties/directOverride/type',
            keyword: 'type',
            params: { type: schema11.properties.directOverride.type },
            message: 'must be boolean,null',
          };
          if (vErrors === null) {
            vErrors = [err45];
          } else {
            vErrors.push(err45);
          }
          errors++;
        }
      }
      if (data.handoffContext !== undefined) {
        let data15 = data.handoffContext;
        if (typeof data15 !== 'string' && data15 !== null) {
          const err46 = {
            instancePath: instancePath + '/handoffContext',
            schemaPath: '#/properties/handoffContext/type',
            keyword: 'type',
            params: { type: schema11.properties.handoffContext.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err46];
          } else {
            vErrors.push(err46);
          }
          errors++;
        }
      }
      if (data.handoffHash !== undefined) {
        let data16 = data.handoffHash;
        const _errs28 = errors;
        let valid1 = false;
        const _errs29 = errors;
        if (data16 !== null) {
          const err47 = {
            instancePath: instancePath + '/handoffHash',
            schemaPath: '#/properties/handoffHash/anyOf/0/type',
            keyword: 'type',
            params: { type: 'null' },
            message: 'must be null',
          };
          if (vErrors === null) {
            vErrors = [err47];
          } else {
            vErrors.push(err47);
          }
          errors++;
        }
        var _valid0 = _errs29 === errors;
        valid1 = valid1 || _valid0;
        if (!valid1) {
          const _errs31 = errors;
          if (typeof data16 === 'string') {
            if (!pattern0.test(data16)) {
              const err48 = {
                instancePath: instancePath + '/handoffHash',
                schemaPath: '#/properties/handoffHash/anyOf/1/pattern',
                keyword: 'pattern',
                params: { pattern: '^[a-f0-9]{64}$' },
                message: 'must match pattern "' + '^[a-f0-9]{64}$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err48];
              } else {
                vErrors.push(err48);
              }
              errors++;
            }
          } else {
            const err49 = {
              instancePath: instancePath + '/handoffHash',
              schemaPath: '#/properties/handoffHash/anyOf/1/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err49];
            } else {
              vErrors.push(err49);
            }
            errors++;
          }
          var _valid0 = _errs31 === errors;
          valid1 = valid1 || _valid0;
        }
        if (!valid1) {
          const err50 = {
            instancePath: instancePath + '/handoffHash',
            schemaPath: '#/properties/handoffHash/anyOf',
            keyword: 'anyOf',
            params: {},
            message: 'must match a schema in anyOf',
          };
          if (vErrors === null) {
            vErrors = [err50];
          } else {
            vErrors.push(err50);
          }
          errors++;
        } else {
          errors = _errs28;
          if (vErrors !== null) {
            if (_errs28) {
              vErrors.length = _errs28;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (data.isolation !== undefined) {
        let data17 = data.isolation;
        if (!(
          data17 === null ||
          data17 === 'current' ||
          data17 === 'branch' ||
          data17 === 'worktree'
        )) {
          const err51 = {
            instancePath: instancePath + '/isolation',
            schemaPath: '#/properties/isolation/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.isolation.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err51];
          } else {
            vErrors.push(err51);
          }
          errors++;
        }
      }
      if (data.language !== undefined) {
        let data18 = data.language;
        if (!(data18 === null || data18 === 'en' || data18 === 'zh-CN')) {
          const err52 = {
            instancePath: instancePath + '/language',
            schemaPath: '#/properties/language/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.language.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err52];
          } else {
            vErrors.push(err52);
          }
          errors++;
        }
      }
      if (data.phase !== undefined) {
        let data19 = data.phase;
        if (!(
          data19 === 'open' ||
          data19 === 'design' ||
          data19 === 'build' ||
          data19 === 'verify' ||
          data19 === 'archive'
        )) {
          const err53 = {
            instancePath: instancePath + '/phase',
            schemaPath: '#/properties/phase/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.phase.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err53];
          } else {
            vErrors.push(err53);
          }
          errors++;
        }
      }
      if (data.plan !== undefined) {
        let data20 = data.plan;
        if (typeof data20 !== 'string' && data20 !== null) {
          const err54 = {
            instancePath: instancePath + '/plan',
            schemaPath: '#/properties/plan/type',
            keyword: 'type',
            params: { type: schema11.properties.plan.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err54];
          } else {
            vErrors.push(err54);
          }
          errors++;
        }
      }
      if (data.reviewMode !== undefined) {
        let data21 = data.reviewMode;
        if (!(
          data21 === null ||
          data21 === 'off' ||
          data21 === 'standard' ||
          data21 === 'thorough'
        )) {
          const err55 = {
            instancePath: instancePath + '/reviewMode',
            schemaPath: '#/properties/reviewMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.reviewMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err55];
          } else {
            vErrors.push(err55);
          }
          errors++;
        }
      }
      if (data.subagentDispatch !== undefined) {
        let data22 = data.subagentDispatch;
        if (!(data22 === null || data22 === 'confirmed')) {
          const err56 = {
            instancePath: instancePath + '/subagentDispatch',
            schemaPath: '#/properties/subagentDispatch/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.subagentDispatch.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err56];
          } else {
            vErrors.push(err56);
          }
          errors++;
        }
      }
      if (data.tddMode !== undefined) {
        let data23 = data.tddMode;
        if (!(data23 === null || data23 === 'tdd' || data23 === 'direct')) {
          const err57 = {
            instancePath: instancePath + '/tddMode',
            schemaPath: '#/properties/tddMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.tddMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err57];
          } else {
            vErrors.push(err57);
          }
          errors++;
        }
      }
      if (data.verificationReport !== undefined) {
        let data24 = data.verificationReport;
        if (typeof data24 !== 'string' && data24 !== null) {
          const err58 = {
            instancePath: instancePath + '/verificationReport',
            schemaPath: '#/properties/verificationReport/type',
            keyword: 'type',
            params: { type: schema11.properties.verificationReport.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err58];
          } else {
            vErrors.push(err58);
          }
          errors++;
        }
      }
      if (data.verifiedAt !== undefined) {
        let data25 = data.verifiedAt;
        if (typeof data25 !== 'string' && data25 !== null) {
          const err59 = {
            instancePath: instancePath + '/verifiedAt',
            schemaPath: '#/properties/verifiedAt/type',
            keyword: 'type',
            params: { type: schema11.properties.verifiedAt.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err59];
          } else {
            vErrors.push(err59);
          }
          errors++;
        }
      }
      if (data.verifyFailures !== undefined) {
        let data26 = data.verifyFailures;
        if (!(typeof data26 == 'number' && !(data26 % 1) && !isNaN(data26) && isFinite(data26))) {
          const err60 = {
            instancePath: instancePath + '/verifyFailures',
            schemaPath: '#/properties/verifyFailures/type',
            keyword: 'type',
            params: { type: 'integer' },
            message: 'must be integer',
          };
          if (vErrors === null) {
            vErrors = [err60];
          } else {
            vErrors.push(err60);
          }
          errors++;
        }
        if (typeof data26 == 'number' && isFinite(data26)) {
          if (data26 < 0 || isNaN(data26)) {
            const err61 = {
              instancePath: instancePath + '/verifyFailures',
              schemaPath: '#/properties/verifyFailures/minimum',
              keyword: 'minimum',
              params: { comparison: '>=', limit: 0 },
              message: 'must be >= 0',
            };
            if (vErrors === null) {
              vErrors = [err61];
            } else {
              vErrors.push(err61);
            }
            errors++;
          }
        }
      }
      if (data.verifyMode !== undefined) {
        let data27 = data.verifyMode;
        if (!(data27 === null || data27 === 'light' || data27 === 'full')) {
          const err62 = {
            instancePath: instancePath + '/verifyMode',
            schemaPath: '#/properties/verifyMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.verifyMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err62];
          } else {
            vErrors.push(err62);
          }
          errors++;
        }
      }
      if (data.verifyResult !== undefined) {
        let data28 = data.verifyResult;
        if (!(data28 === 'pending' || data28 === 'pass' || data28 === 'fail')) {
          const err63 = {
            instancePath: instancePath + '/verifyResult',
            schemaPath: '#/properties/verifyResult/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.verifyResult.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err63];
          } else {
            vErrors.push(err63);
          }
          errors++;
        }
      }
      if (data.workflow !== undefined) {
        if (!(data.workflow === 'full')) {
          const err64 = {
            instancePath: instancePath + '/workflow',
            schemaPath: '#/properties/workflow/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.workflow.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err64];
          } else {
            vErrors.push(err64);
          }
          errors++;
        }
      }
    } else {
      const err65 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err65];
      } else {
        vErrors.push(err65);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator2 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    additionalProperties: false,
    properties: {
      archiveConfirmation: { enum: [null, 'pending', 'confirmed'] },
      archived: { type: 'boolean' },
      autoTransition: { type: ['boolean', 'null'] },
      baseRef: { type: ['string', 'null'] },
      boundBranch: { type: ['string', 'null'] },
      branchStatus: { enum: [null, 'pending', 'handled'] },
      buildMode: {
        enum: [null, 'subagent-driven-development', 'executing-plans', 'direct', 'autonomous'],
      },
      buildPause: { enum: [null, 'plan-ready'] },
      checkEpoch: { minimum: 0, type: 'integer' },
      classicMigration: { enum: [null, 1] },
      classicProfile: { enum: [null, 'full', 'hotfix', 'tweak'] },
      contextCompression: { enum: [null, 'off', 'beta'] },
      createdAt: { type: ['string', 'null'] },
      designDoc: { type: ['string', 'null'] },
      directOverride: { type: ['boolean', 'null'] },
      handoffContext: { type: ['string', 'null'] },
      handoffHash: { anyOf: [{ type: 'null' }, { pattern: '^[a-f0-9]{64}$', type: 'string' }] },
      isolation: { enum: [null, 'current', 'branch', 'worktree'] },
      language: { enum: [null, 'en', 'zh-CN'] },
      phase: { enum: ['open', 'design', 'build', 'verify', 'archive'] },
      plan: { type: ['string', 'null'] },
      reviewMode: { enum: [null, 'off', 'standard', 'thorough'] },
      subagentDispatch: { enum: [null, 'confirmed'] },
      tddMode: { enum: [null, 'tdd', 'direct'] },
      verificationReport: { type: ['string', 'null'] },
      verifiedAt: { type: ['string', 'null'] },
      verifyFailures: { minimum: 0, type: 'integer' },
      verifyMode: { enum: [null, 'light', 'full'] },
      verifyResult: { enum: ['pending', 'pass', 'fail'] },
      workflow: { enum: ['hotfix', 'full'] },
    },
    required: [
      'workflow',
      'language',
      'phase',
      'contextCompression',
      'buildMode',
      'buildPause',
      'subagentDispatch',
      'tddMode',
      'reviewMode',
      'isolation',
      'boundBranch',
      'verifyMode',
      'autoTransition',
      'baseRef',
      'designDoc',
      'plan',
      'verifyResult',
      'verifyFailures',
      'verificationReport',
      'branchStatus',
      'createdAt',
      'verifiedAt',
      'archiveConfirmation',
      'archived',
      'directOverride',
      'handoffContext',
      'handoffHash',
      'classicProfile',
      'classicMigration',
    ],
    type: 'object',
  };
  const func2 = Object.prototype.hasOwnProperty;
  const pattern0 = new RegExp('^[a-f0-9]{64}$', 'u');
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.workflow === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'workflow' },
          message: "must have required property '" + 'workflow' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      if (data.language === undefined) {
        const err1 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'language' },
          message: "must have required property '" + 'language' + "'",
        };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
      if (data.phase === undefined) {
        const err2 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'phase' },
          message: "must have required property '" + 'phase' + "'",
        };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      if (data.contextCompression === undefined) {
        const err3 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'contextCompression' },
          message: "must have required property '" + 'contextCompression' + "'",
        };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
      if (data.buildMode === undefined) {
        const err4 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'buildMode' },
          message: "must have required property '" + 'buildMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
      if (data.buildPause === undefined) {
        const err5 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'buildPause' },
          message: "must have required property '" + 'buildPause' + "'",
        };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
      if (data.subagentDispatch === undefined) {
        const err6 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'subagentDispatch' },
          message: "must have required property '" + 'subagentDispatch' + "'",
        };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
      if (data.tddMode === undefined) {
        const err7 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'tddMode' },
          message: "must have required property '" + 'tddMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
      if (data.reviewMode === undefined) {
        const err8 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'reviewMode' },
          message: "must have required property '" + 'reviewMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
      if (data.isolation === undefined) {
        const err9 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'isolation' },
          message: "must have required property '" + 'isolation' + "'",
        };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
      if (data.boundBranch === undefined) {
        const err10 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'boundBranch' },
          message: "must have required property '" + 'boundBranch' + "'",
        };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
      if (data.verifyMode === undefined) {
        const err11 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verifyMode' },
          message: "must have required property '" + 'verifyMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
      if (data.autoTransition === undefined) {
        const err12 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'autoTransition' },
          message: "must have required property '" + 'autoTransition' + "'",
        };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
      if (data.baseRef === undefined) {
        const err13 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'baseRef' },
          message: "must have required property '" + 'baseRef' + "'",
        };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
      if (data.designDoc === undefined) {
        const err14 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'designDoc' },
          message: "must have required property '" + 'designDoc' + "'",
        };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
      if (data.plan === undefined) {
        const err15 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'plan' },
          message: "must have required property '" + 'plan' + "'",
        };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
      if (data.verifyResult === undefined) {
        const err16 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verifyResult' },
          message: "must have required property '" + 'verifyResult' + "'",
        };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
      if (data.verifyFailures === undefined) {
        const err17 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verifyFailures' },
          message: "must have required property '" + 'verifyFailures' + "'",
        };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
      if (data.verificationReport === undefined) {
        const err18 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verificationReport' },
          message: "must have required property '" + 'verificationReport' + "'",
        };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
      if (data.branchStatus === undefined) {
        const err19 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'branchStatus' },
          message: "must have required property '" + 'branchStatus' + "'",
        };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
      if (data.createdAt === undefined) {
        const err20 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'createdAt' },
          message: "must have required property '" + 'createdAt' + "'",
        };
        if (vErrors === null) {
          vErrors = [err20];
        } else {
          vErrors.push(err20);
        }
        errors++;
      }
      if (data.verifiedAt === undefined) {
        const err21 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verifiedAt' },
          message: "must have required property '" + 'verifiedAt' + "'",
        };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
      if (data.archiveConfirmation === undefined) {
        const err22 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'archiveConfirmation' },
          message: "must have required property '" + 'archiveConfirmation' + "'",
        };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
      if (data.archived === undefined) {
        const err23 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'archived' },
          message: "must have required property '" + 'archived' + "'",
        };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
      if (data.directOverride === undefined) {
        const err24 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'directOverride' },
          message: "must have required property '" + 'directOverride' + "'",
        };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
      if (data.handoffContext === undefined) {
        const err25 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'handoffContext' },
          message: "must have required property '" + 'handoffContext' + "'",
        };
        if (vErrors === null) {
          vErrors = [err25];
        } else {
          vErrors.push(err25);
        }
        errors++;
      }
      if (data.handoffHash === undefined) {
        const err26 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'handoffHash' },
          message: "must have required property '" + 'handoffHash' + "'",
        };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
      if (data.classicProfile === undefined) {
        const err27 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'classicProfile' },
          message: "must have required property '" + 'classicProfile' + "'",
        };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
      if (data.classicMigration === undefined) {
        const err28 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'classicMigration' },
          message: "must have required property '" + 'classicMigration' + "'",
        };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
      for (const key0 in data) {
        if (!func2.call(schema11.properties, key0)) {
          const err29 = {
            instancePath,
            schemaPath: '#/additionalProperties',
            keyword: 'additionalProperties',
            params: { additionalProperty: key0 },
            message: 'must NOT have additional properties',
          };
          if (vErrors === null) {
            vErrors = [err29];
          } else {
            vErrors.push(err29);
          }
          errors++;
        }
      }
      if (data.archiveConfirmation !== undefined) {
        let data0 = data.archiveConfirmation;
        if (!(data0 === null || data0 === 'pending' || data0 === 'confirmed')) {
          const err30 = {
            instancePath: instancePath + '/archiveConfirmation',
            schemaPath: '#/properties/archiveConfirmation/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.archiveConfirmation.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
      }
      if (data.archived !== undefined) {
        if (typeof data.archived !== 'boolean') {
          const err31 = {
            instancePath: instancePath + '/archived',
            schemaPath: '#/properties/archived/type',
            keyword: 'type',
            params: { type: 'boolean' },
            message: 'must be boolean',
          };
          if (vErrors === null) {
            vErrors = [err31];
          } else {
            vErrors.push(err31);
          }
          errors++;
        }
      }
      if (data.autoTransition !== undefined) {
        let data2 = data.autoTransition;
        if (typeof data2 !== 'boolean' && data2 !== null) {
          const err32 = {
            instancePath: instancePath + '/autoTransition',
            schemaPath: '#/properties/autoTransition/type',
            keyword: 'type',
            params: { type: schema11.properties.autoTransition.type },
            message: 'must be boolean,null',
          };
          if (vErrors === null) {
            vErrors = [err32];
          } else {
            vErrors.push(err32);
          }
          errors++;
        }
      }
      if (data.baseRef !== undefined) {
        let data3 = data.baseRef;
        if (typeof data3 !== 'string' && data3 !== null) {
          const err33 = {
            instancePath: instancePath + '/baseRef',
            schemaPath: '#/properties/baseRef/type',
            keyword: 'type',
            params: { type: schema11.properties.baseRef.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err33];
          } else {
            vErrors.push(err33);
          }
          errors++;
        }
      }
      if (data.boundBranch !== undefined) {
        let data4 = data.boundBranch;
        if (typeof data4 !== 'string' && data4 !== null) {
          const err34 = {
            instancePath: instancePath + '/boundBranch',
            schemaPath: '#/properties/boundBranch/type',
            keyword: 'type',
            params: { type: schema11.properties.boundBranch.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err34];
          } else {
            vErrors.push(err34);
          }
          errors++;
        }
      }
      if (data.branchStatus !== undefined) {
        let data5 = data.branchStatus;
        if (!(data5 === null || data5 === 'pending' || data5 === 'handled')) {
          const err35 = {
            instancePath: instancePath + '/branchStatus',
            schemaPath: '#/properties/branchStatus/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.branchStatus.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err35];
          } else {
            vErrors.push(err35);
          }
          errors++;
        }
      }
      if (data.buildMode !== undefined) {
        let data6 = data.buildMode;
        if (!(
          data6 === null ||
          data6 === 'subagent-driven-development' ||
          data6 === 'executing-plans' ||
          data6 === 'direct' ||
          data6 === 'autonomous'
        )) {
          const err36 = {
            instancePath: instancePath + '/buildMode',
            schemaPath: '#/properties/buildMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.buildMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err36];
          } else {
            vErrors.push(err36);
          }
          errors++;
        }
      }
      if (data.buildPause !== undefined) {
        let data7 = data.buildPause;
        if (!(data7 === null || data7 === 'plan-ready')) {
          const err37 = {
            instancePath: instancePath + '/buildPause',
            schemaPath: '#/properties/buildPause/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.buildPause.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err37];
          } else {
            vErrors.push(err37);
          }
          errors++;
        }
      }
      if (data.checkEpoch !== undefined) {
        let data8 = data.checkEpoch;
        if (!(typeof data8 == 'number' && !(data8 % 1) && !isNaN(data8) && isFinite(data8))) {
          const err38 = {
            instancePath: instancePath + '/checkEpoch',
            schemaPath: '#/properties/checkEpoch/type',
            keyword: 'type',
            params: { type: 'integer' },
            message: 'must be integer',
          };
          if (vErrors === null) {
            vErrors = [err38];
          } else {
            vErrors.push(err38);
          }
          errors++;
        }
        if (typeof data8 == 'number' && isFinite(data8)) {
          if (data8 < 0 || isNaN(data8)) {
            const err39 = {
              instancePath: instancePath + '/checkEpoch',
              schemaPath: '#/properties/checkEpoch/minimum',
              keyword: 'minimum',
              params: { comparison: '>=', limit: 0 },
              message: 'must be >= 0',
            };
            if (vErrors === null) {
              vErrors = [err39];
            } else {
              vErrors.push(err39);
            }
            errors++;
          }
        }
      }
      if (data.classicMigration !== undefined) {
        let data9 = data.classicMigration;
        if (!(data9 === null || data9 === 1)) {
          const err40 = {
            instancePath: instancePath + '/classicMigration',
            schemaPath: '#/properties/classicMigration/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.classicMigration.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
      }
      if (data.classicProfile !== undefined) {
        let data10 = data.classicProfile;
        if (!(data10 === null || data10 === 'full' || data10 === 'hotfix' || data10 === 'tweak')) {
          const err41 = {
            instancePath: instancePath + '/classicProfile',
            schemaPath: '#/properties/classicProfile/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.classicProfile.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err41];
          } else {
            vErrors.push(err41);
          }
          errors++;
        }
      }
      if (data.contextCompression !== undefined) {
        let data11 = data.contextCompression;
        if (!(data11 === null || data11 === 'off' || data11 === 'beta')) {
          const err42 = {
            instancePath: instancePath + '/contextCompression',
            schemaPath: '#/properties/contextCompression/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.contextCompression.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err42];
          } else {
            vErrors.push(err42);
          }
          errors++;
        }
      }
      if (data.createdAt !== undefined) {
        let data12 = data.createdAt;
        if (typeof data12 !== 'string' && data12 !== null) {
          const err43 = {
            instancePath: instancePath + '/createdAt',
            schemaPath: '#/properties/createdAt/type',
            keyword: 'type',
            params: { type: schema11.properties.createdAt.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err43];
          } else {
            vErrors.push(err43);
          }
          errors++;
        }
      }
      if (data.designDoc !== undefined) {
        let data13 = data.designDoc;
        if (typeof data13 !== 'string' && data13 !== null) {
          const err44 = {
            instancePath: instancePath + '/designDoc',
            schemaPath: '#/properties/designDoc/type',
            keyword: 'type',
            params: { type: schema11.properties.designDoc.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err44];
          } else {
            vErrors.push(err44);
          }
          errors++;
        }
      }
      if (data.directOverride !== undefined) {
        let data14 = data.directOverride;
        if (typeof data14 !== 'boolean' && data14 !== null) {
          const err45 = {
            instancePath: instancePath + '/directOverride',
            schemaPath: '#/properties/directOverride/type',
            keyword: 'type',
            params: { type: schema11.properties.directOverride.type },
            message: 'must be boolean,null',
          };
          if (vErrors === null) {
            vErrors = [err45];
          } else {
            vErrors.push(err45);
          }
          errors++;
        }
      }
      if (data.handoffContext !== undefined) {
        let data15 = data.handoffContext;
        if (typeof data15 !== 'string' && data15 !== null) {
          const err46 = {
            instancePath: instancePath + '/handoffContext',
            schemaPath: '#/properties/handoffContext/type',
            keyword: 'type',
            params: { type: schema11.properties.handoffContext.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err46];
          } else {
            vErrors.push(err46);
          }
          errors++;
        }
      }
      if (data.handoffHash !== undefined) {
        let data16 = data.handoffHash;
        const _errs28 = errors;
        let valid1 = false;
        const _errs29 = errors;
        if (data16 !== null) {
          const err47 = {
            instancePath: instancePath + '/handoffHash',
            schemaPath: '#/properties/handoffHash/anyOf/0/type',
            keyword: 'type',
            params: { type: 'null' },
            message: 'must be null',
          };
          if (vErrors === null) {
            vErrors = [err47];
          } else {
            vErrors.push(err47);
          }
          errors++;
        }
        var _valid0 = _errs29 === errors;
        valid1 = valid1 || _valid0;
        if (!valid1) {
          const _errs31 = errors;
          if (typeof data16 === 'string') {
            if (!pattern0.test(data16)) {
              const err48 = {
                instancePath: instancePath + '/handoffHash',
                schemaPath: '#/properties/handoffHash/anyOf/1/pattern',
                keyword: 'pattern',
                params: { pattern: '^[a-f0-9]{64}$' },
                message: 'must match pattern "' + '^[a-f0-9]{64}$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err48];
              } else {
                vErrors.push(err48);
              }
              errors++;
            }
          } else {
            const err49 = {
              instancePath: instancePath + '/handoffHash',
              schemaPath: '#/properties/handoffHash/anyOf/1/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err49];
            } else {
              vErrors.push(err49);
            }
            errors++;
          }
          var _valid0 = _errs31 === errors;
          valid1 = valid1 || _valid0;
        }
        if (!valid1) {
          const err50 = {
            instancePath: instancePath + '/handoffHash',
            schemaPath: '#/properties/handoffHash/anyOf',
            keyword: 'anyOf',
            params: {},
            message: 'must match a schema in anyOf',
          };
          if (vErrors === null) {
            vErrors = [err50];
          } else {
            vErrors.push(err50);
          }
          errors++;
        } else {
          errors = _errs28;
          if (vErrors !== null) {
            if (_errs28) {
              vErrors.length = _errs28;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (data.isolation !== undefined) {
        let data17 = data.isolation;
        if (!(
          data17 === null ||
          data17 === 'current' ||
          data17 === 'branch' ||
          data17 === 'worktree'
        )) {
          const err51 = {
            instancePath: instancePath + '/isolation',
            schemaPath: '#/properties/isolation/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.isolation.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err51];
          } else {
            vErrors.push(err51);
          }
          errors++;
        }
      }
      if (data.language !== undefined) {
        let data18 = data.language;
        if (!(data18 === null || data18 === 'en' || data18 === 'zh-CN')) {
          const err52 = {
            instancePath: instancePath + '/language',
            schemaPath: '#/properties/language/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.language.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err52];
          } else {
            vErrors.push(err52);
          }
          errors++;
        }
      }
      if (data.phase !== undefined) {
        let data19 = data.phase;
        if (!(
          data19 === 'open' ||
          data19 === 'design' ||
          data19 === 'build' ||
          data19 === 'verify' ||
          data19 === 'archive'
        )) {
          const err53 = {
            instancePath: instancePath + '/phase',
            schemaPath: '#/properties/phase/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.phase.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err53];
          } else {
            vErrors.push(err53);
          }
          errors++;
        }
      }
      if (data.plan !== undefined) {
        let data20 = data.plan;
        if (typeof data20 !== 'string' && data20 !== null) {
          const err54 = {
            instancePath: instancePath + '/plan',
            schemaPath: '#/properties/plan/type',
            keyword: 'type',
            params: { type: schema11.properties.plan.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err54];
          } else {
            vErrors.push(err54);
          }
          errors++;
        }
      }
      if (data.reviewMode !== undefined) {
        let data21 = data.reviewMode;
        if (!(
          data21 === null ||
          data21 === 'off' ||
          data21 === 'standard' ||
          data21 === 'thorough'
        )) {
          const err55 = {
            instancePath: instancePath + '/reviewMode',
            schemaPath: '#/properties/reviewMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.reviewMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err55];
          } else {
            vErrors.push(err55);
          }
          errors++;
        }
      }
      if (data.subagentDispatch !== undefined) {
        let data22 = data.subagentDispatch;
        if (!(data22 === null || data22 === 'confirmed')) {
          const err56 = {
            instancePath: instancePath + '/subagentDispatch',
            schemaPath: '#/properties/subagentDispatch/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.subagentDispatch.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err56];
          } else {
            vErrors.push(err56);
          }
          errors++;
        }
      }
      if (data.tddMode !== undefined) {
        let data23 = data.tddMode;
        if (!(data23 === null || data23 === 'tdd' || data23 === 'direct')) {
          const err57 = {
            instancePath: instancePath + '/tddMode',
            schemaPath: '#/properties/tddMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.tddMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err57];
          } else {
            vErrors.push(err57);
          }
          errors++;
        }
      }
      if (data.verificationReport !== undefined) {
        let data24 = data.verificationReport;
        if (typeof data24 !== 'string' && data24 !== null) {
          const err58 = {
            instancePath: instancePath + '/verificationReport',
            schemaPath: '#/properties/verificationReport/type',
            keyword: 'type',
            params: { type: schema11.properties.verificationReport.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err58];
          } else {
            vErrors.push(err58);
          }
          errors++;
        }
      }
      if (data.verifiedAt !== undefined) {
        let data25 = data.verifiedAt;
        if (typeof data25 !== 'string' && data25 !== null) {
          const err59 = {
            instancePath: instancePath + '/verifiedAt',
            schemaPath: '#/properties/verifiedAt/type',
            keyword: 'type',
            params: { type: schema11.properties.verifiedAt.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err59];
          } else {
            vErrors.push(err59);
          }
          errors++;
        }
      }
      if (data.verifyFailures !== undefined) {
        let data26 = data.verifyFailures;
        if (!(typeof data26 == 'number' && !(data26 % 1) && !isNaN(data26) && isFinite(data26))) {
          const err60 = {
            instancePath: instancePath + '/verifyFailures',
            schemaPath: '#/properties/verifyFailures/type',
            keyword: 'type',
            params: { type: 'integer' },
            message: 'must be integer',
          };
          if (vErrors === null) {
            vErrors = [err60];
          } else {
            vErrors.push(err60);
          }
          errors++;
        }
        if (typeof data26 == 'number' && isFinite(data26)) {
          if (data26 < 0 || isNaN(data26)) {
            const err61 = {
              instancePath: instancePath + '/verifyFailures',
              schemaPath: '#/properties/verifyFailures/minimum',
              keyword: 'minimum',
              params: { comparison: '>=', limit: 0 },
              message: 'must be >= 0',
            };
            if (vErrors === null) {
              vErrors = [err61];
            } else {
              vErrors.push(err61);
            }
            errors++;
          }
        }
      }
      if (data.verifyMode !== undefined) {
        let data27 = data.verifyMode;
        if (!(data27 === null || data27 === 'light' || data27 === 'full')) {
          const err62 = {
            instancePath: instancePath + '/verifyMode',
            schemaPath: '#/properties/verifyMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.verifyMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err62];
          } else {
            vErrors.push(err62);
          }
          errors++;
        }
      }
      if (data.verifyResult !== undefined) {
        let data28 = data.verifyResult;
        if (!(data28 === 'pending' || data28 === 'pass' || data28 === 'fail')) {
          const err63 = {
            instancePath: instancePath + '/verifyResult',
            schemaPath: '#/properties/verifyResult/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.verifyResult.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err63];
          } else {
            vErrors.push(err63);
          }
          errors++;
        }
      }
      if (data.workflow !== undefined) {
        let data29 = data.workflow;
        if (!(data29 === 'hotfix' || data29 === 'full')) {
          const err64 = {
            instancePath: instancePath + '/workflow',
            schemaPath: '#/properties/workflow/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.workflow.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err64];
          } else {
            vErrors.push(err64);
          }
          errors++;
        }
      }
    } else {
      const err65 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err65];
      } else {
        vErrors.push(err65);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator3 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    additionalProperties: false,
    properties: {
      archiveConfirmation: { enum: [null, 'pending', 'confirmed'] },
      archived: { type: 'boolean' },
      autoTransition: { type: ['boolean', 'null'] },
      baseRef: { type: ['string', 'null'] },
      boundBranch: { type: ['string', 'null'] },
      branchStatus: { enum: [null, 'pending', 'handled'] },
      buildMode: {
        enum: [null, 'subagent-driven-development', 'executing-plans', 'direct', 'autonomous'],
      },
      buildPause: { enum: [null, 'plan-ready'] },
      checkEpoch: { minimum: 0, type: 'integer' },
      classicMigration: { enum: [null, 1] },
      classicProfile: { enum: [null, 'full', 'hotfix', 'tweak'] },
      contextCompression: { enum: [null, 'off', 'beta'] },
      createdAt: { type: ['string', 'null'] },
      designDoc: { type: ['string', 'null'] },
      directOverride: { type: ['boolean', 'null'] },
      handoffContext: { type: ['string', 'null'] },
      handoffHash: { anyOf: [{ type: 'null' }, { pattern: '^[a-f0-9]{64}$', type: 'string' }] },
      isolation: { enum: [null, 'current', 'branch', 'worktree'] },
      language: { enum: [null, 'en', 'zh-CN'] },
      phase: { enum: ['open', 'design', 'build', 'verify', 'archive'] },
      plan: { type: ['string', 'null'] },
      reviewMode: { enum: [null, 'off', 'standard', 'thorough'] },
      subagentDispatch: { enum: [null, 'confirmed'] },
      tddMode: { enum: [null, 'tdd', 'direct'] },
      verificationReport: { type: ['string', 'null'] },
      verifiedAt: { type: ['string', 'null'] },
      verifyFailures: { minimum: 0, type: 'integer' },
      verifyMode: { enum: [null, 'light', 'full'] },
      verifyResult: { enum: ['pending', 'pass', 'fail'] },
      workflow: { enum: ['tweak', 'full'] },
    },
    required: [
      'workflow',
      'language',
      'phase',
      'contextCompression',
      'buildMode',
      'buildPause',
      'subagentDispatch',
      'tddMode',
      'reviewMode',
      'isolation',
      'boundBranch',
      'verifyMode',
      'autoTransition',
      'baseRef',
      'designDoc',
      'plan',
      'verifyResult',
      'verifyFailures',
      'verificationReport',
      'branchStatus',
      'createdAt',
      'verifiedAt',
      'archiveConfirmation',
      'archived',
      'directOverride',
      'handoffContext',
      'handoffHash',
      'classicProfile',
      'classicMigration',
    ],
    type: 'object',
  };
  const func2 = Object.prototype.hasOwnProperty;
  const pattern0 = new RegExp('^[a-f0-9]{64}$', 'u');
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.workflow === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'workflow' },
          message: "must have required property '" + 'workflow' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      if (data.language === undefined) {
        const err1 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'language' },
          message: "must have required property '" + 'language' + "'",
        };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
      if (data.phase === undefined) {
        const err2 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'phase' },
          message: "must have required property '" + 'phase' + "'",
        };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      if (data.contextCompression === undefined) {
        const err3 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'contextCompression' },
          message: "must have required property '" + 'contextCompression' + "'",
        };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
      if (data.buildMode === undefined) {
        const err4 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'buildMode' },
          message: "must have required property '" + 'buildMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err4];
        } else {
          vErrors.push(err4);
        }
        errors++;
      }
      if (data.buildPause === undefined) {
        const err5 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'buildPause' },
          message: "must have required property '" + 'buildPause' + "'",
        };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
      if (data.subagentDispatch === undefined) {
        const err6 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'subagentDispatch' },
          message: "must have required property '" + 'subagentDispatch' + "'",
        };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
      if (data.tddMode === undefined) {
        const err7 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'tddMode' },
          message: "must have required property '" + 'tddMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err7];
        } else {
          vErrors.push(err7);
        }
        errors++;
      }
      if (data.reviewMode === undefined) {
        const err8 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'reviewMode' },
          message: "must have required property '" + 'reviewMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
      if (data.isolation === undefined) {
        const err9 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'isolation' },
          message: "must have required property '" + 'isolation' + "'",
        };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
      if (data.boundBranch === undefined) {
        const err10 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'boundBranch' },
          message: "must have required property '" + 'boundBranch' + "'",
        };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
      if (data.verifyMode === undefined) {
        const err11 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verifyMode' },
          message: "must have required property '" + 'verifyMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err11];
        } else {
          vErrors.push(err11);
        }
        errors++;
      }
      if (data.autoTransition === undefined) {
        const err12 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'autoTransition' },
          message: "must have required property '" + 'autoTransition' + "'",
        };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
      if (data.baseRef === undefined) {
        const err13 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'baseRef' },
          message: "must have required property '" + 'baseRef' + "'",
        };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
      if (data.designDoc === undefined) {
        const err14 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'designDoc' },
          message: "must have required property '" + 'designDoc' + "'",
        };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
      if (data.plan === undefined) {
        const err15 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'plan' },
          message: "must have required property '" + 'plan' + "'",
        };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
      if (data.verifyResult === undefined) {
        const err16 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verifyResult' },
          message: "must have required property '" + 'verifyResult' + "'",
        };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
      if (data.verifyFailures === undefined) {
        const err17 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verifyFailures' },
          message: "must have required property '" + 'verifyFailures' + "'",
        };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
      if (data.verificationReport === undefined) {
        const err18 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verificationReport' },
          message: "must have required property '" + 'verificationReport' + "'",
        };
        if (vErrors === null) {
          vErrors = [err18];
        } else {
          vErrors.push(err18);
        }
        errors++;
      }
      if (data.branchStatus === undefined) {
        const err19 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'branchStatus' },
          message: "must have required property '" + 'branchStatus' + "'",
        };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
      if (data.createdAt === undefined) {
        const err20 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'createdAt' },
          message: "must have required property '" + 'createdAt' + "'",
        };
        if (vErrors === null) {
          vErrors = [err20];
        } else {
          vErrors.push(err20);
        }
        errors++;
      }
      if (data.verifiedAt === undefined) {
        const err21 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verifiedAt' },
          message: "must have required property '" + 'verifiedAt' + "'",
        };
        if (vErrors === null) {
          vErrors = [err21];
        } else {
          vErrors.push(err21);
        }
        errors++;
      }
      if (data.archiveConfirmation === undefined) {
        const err22 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'archiveConfirmation' },
          message: "must have required property '" + 'archiveConfirmation' + "'",
        };
        if (vErrors === null) {
          vErrors = [err22];
        } else {
          vErrors.push(err22);
        }
        errors++;
      }
      if (data.archived === undefined) {
        const err23 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'archived' },
          message: "must have required property '" + 'archived' + "'",
        };
        if (vErrors === null) {
          vErrors = [err23];
        } else {
          vErrors.push(err23);
        }
        errors++;
      }
      if (data.directOverride === undefined) {
        const err24 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'directOverride' },
          message: "must have required property '" + 'directOverride' + "'",
        };
        if (vErrors === null) {
          vErrors = [err24];
        } else {
          vErrors.push(err24);
        }
        errors++;
      }
      if (data.handoffContext === undefined) {
        const err25 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'handoffContext' },
          message: "must have required property '" + 'handoffContext' + "'",
        };
        if (vErrors === null) {
          vErrors = [err25];
        } else {
          vErrors.push(err25);
        }
        errors++;
      }
      if (data.handoffHash === undefined) {
        const err26 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'handoffHash' },
          message: "must have required property '" + 'handoffHash' + "'",
        };
        if (vErrors === null) {
          vErrors = [err26];
        } else {
          vErrors.push(err26);
        }
        errors++;
      }
      if (data.classicProfile === undefined) {
        const err27 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'classicProfile' },
          message: "must have required property '" + 'classicProfile' + "'",
        };
        if (vErrors === null) {
          vErrors = [err27];
        } else {
          vErrors.push(err27);
        }
        errors++;
      }
      if (data.classicMigration === undefined) {
        const err28 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'classicMigration' },
          message: "must have required property '" + 'classicMigration' + "'",
        };
        if (vErrors === null) {
          vErrors = [err28];
        } else {
          vErrors.push(err28);
        }
        errors++;
      }
      for (const key0 in data) {
        if (!func2.call(schema11.properties, key0)) {
          const err29 = {
            instancePath,
            schemaPath: '#/additionalProperties',
            keyword: 'additionalProperties',
            params: { additionalProperty: key0 },
            message: 'must NOT have additional properties',
          };
          if (vErrors === null) {
            vErrors = [err29];
          } else {
            vErrors.push(err29);
          }
          errors++;
        }
      }
      if (data.archiveConfirmation !== undefined) {
        let data0 = data.archiveConfirmation;
        if (!(data0 === null || data0 === 'pending' || data0 === 'confirmed')) {
          const err30 = {
            instancePath: instancePath + '/archiveConfirmation',
            schemaPath: '#/properties/archiveConfirmation/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.archiveConfirmation.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err30];
          } else {
            vErrors.push(err30);
          }
          errors++;
        }
      }
      if (data.archived !== undefined) {
        if (typeof data.archived !== 'boolean') {
          const err31 = {
            instancePath: instancePath + '/archived',
            schemaPath: '#/properties/archived/type',
            keyword: 'type',
            params: { type: 'boolean' },
            message: 'must be boolean',
          };
          if (vErrors === null) {
            vErrors = [err31];
          } else {
            vErrors.push(err31);
          }
          errors++;
        }
      }
      if (data.autoTransition !== undefined) {
        let data2 = data.autoTransition;
        if (typeof data2 !== 'boolean' && data2 !== null) {
          const err32 = {
            instancePath: instancePath + '/autoTransition',
            schemaPath: '#/properties/autoTransition/type',
            keyword: 'type',
            params: { type: schema11.properties.autoTransition.type },
            message: 'must be boolean,null',
          };
          if (vErrors === null) {
            vErrors = [err32];
          } else {
            vErrors.push(err32);
          }
          errors++;
        }
      }
      if (data.baseRef !== undefined) {
        let data3 = data.baseRef;
        if (typeof data3 !== 'string' && data3 !== null) {
          const err33 = {
            instancePath: instancePath + '/baseRef',
            schemaPath: '#/properties/baseRef/type',
            keyword: 'type',
            params: { type: schema11.properties.baseRef.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err33];
          } else {
            vErrors.push(err33);
          }
          errors++;
        }
      }
      if (data.boundBranch !== undefined) {
        let data4 = data.boundBranch;
        if (typeof data4 !== 'string' && data4 !== null) {
          const err34 = {
            instancePath: instancePath + '/boundBranch',
            schemaPath: '#/properties/boundBranch/type',
            keyword: 'type',
            params: { type: schema11.properties.boundBranch.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err34];
          } else {
            vErrors.push(err34);
          }
          errors++;
        }
      }
      if (data.branchStatus !== undefined) {
        let data5 = data.branchStatus;
        if (!(data5 === null || data5 === 'pending' || data5 === 'handled')) {
          const err35 = {
            instancePath: instancePath + '/branchStatus',
            schemaPath: '#/properties/branchStatus/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.branchStatus.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err35];
          } else {
            vErrors.push(err35);
          }
          errors++;
        }
      }
      if (data.buildMode !== undefined) {
        let data6 = data.buildMode;
        if (!(
          data6 === null ||
          data6 === 'subagent-driven-development' ||
          data6 === 'executing-plans' ||
          data6 === 'direct' ||
          data6 === 'autonomous'
        )) {
          const err36 = {
            instancePath: instancePath + '/buildMode',
            schemaPath: '#/properties/buildMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.buildMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err36];
          } else {
            vErrors.push(err36);
          }
          errors++;
        }
      }
      if (data.buildPause !== undefined) {
        let data7 = data.buildPause;
        if (!(data7 === null || data7 === 'plan-ready')) {
          const err37 = {
            instancePath: instancePath + '/buildPause',
            schemaPath: '#/properties/buildPause/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.buildPause.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err37];
          } else {
            vErrors.push(err37);
          }
          errors++;
        }
      }
      if (data.checkEpoch !== undefined) {
        let data8 = data.checkEpoch;
        if (!(typeof data8 == 'number' && !(data8 % 1) && !isNaN(data8) && isFinite(data8))) {
          const err38 = {
            instancePath: instancePath + '/checkEpoch',
            schemaPath: '#/properties/checkEpoch/type',
            keyword: 'type',
            params: { type: 'integer' },
            message: 'must be integer',
          };
          if (vErrors === null) {
            vErrors = [err38];
          } else {
            vErrors.push(err38);
          }
          errors++;
        }
        if (typeof data8 == 'number' && isFinite(data8)) {
          if (data8 < 0 || isNaN(data8)) {
            const err39 = {
              instancePath: instancePath + '/checkEpoch',
              schemaPath: '#/properties/checkEpoch/minimum',
              keyword: 'minimum',
              params: { comparison: '>=', limit: 0 },
              message: 'must be >= 0',
            };
            if (vErrors === null) {
              vErrors = [err39];
            } else {
              vErrors.push(err39);
            }
            errors++;
          }
        }
      }
      if (data.classicMigration !== undefined) {
        let data9 = data.classicMigration;
        if (!(data9 === null || data9 === 1)) {
          const err40 = {
            instancePath: instancePath + '/classicMigration',
            schemaPath: '#/properties/classicMigration/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.classicMigration.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err40];
          } else {
            vErrors.push(err40);
          }
          errors++;
        }
      }
      if (data.classicProfile !== undefined) {
        let data10 = data.classicProfile;
        if (!(data10 === null || data10 === 'full' || data10 === 'hotfix' || data10 === 'tweak')) {
          const err41 = {
            instancePath: instancePath + '/classicProfile',
            schemaPath: '#/properties/classicProfile/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.classicProfile.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err41];
          } else {
            vErrors.push(err41);
          }
          errors++;
        }
      }
      if (data.contextCompression !== undefined) {
        let data11 = data.contextCompression;
        if (!(data11 === null || data11 === 'off' || data11 === 'beta')) {
          const err42 = {
            instancePath: instancePath + '/contextCompression',
            schemaPath: '#/properties/contextCompression/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.contextCompression.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err42];
          } else {
            vErrors.push(err42);
          }
          errors++;
        }
      }
      if (data.createdAt !== undefined) {
        let data12 = data.createdAt;
        if (typeof data12 !== 'string' && data12 !== null) {
          const err43 = {
            instancePath: instancePath + '/createdAt',
            schemaPath: '#/properties/createdAt/type',
            keyword: 'type',
            params: { type: schema11.properties.createdAt.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err43];
          } else {
            vErrors.push(err43);
          }
          errors++;
        }
      }
      if (data.designDoc !== undefined) {
        let data13 = data.designDoc;
        if (typeof data13 !== 'string' && data13 !== null) {
          const err44 = {
            instancePath: instancePath + '/designDoc',
            schemaPath: '#/properties/designDoc/type',
            keyword: 'type',
            params: { type: schema11.properties.designDoc.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err44];
          } else {
            vErrors.push(err44);
          }
          errors++;
        }
      }
      if (data.directOverride !== undefined) {
        let data14 = data.directOverride;
        if (typeof data14 !== 'boolean' && data14 !== null) {
          const err45 = {
            instancePath: instancePath + '/directOverride',
            schemaPath: '#/properties/directOverride/type',
            keyword: 'type',
            params: { type: schema11.properties.directOverride.type },
            message: 'must be boolean,null',
          };
          if (vErrors === null) {
            vErrors = [err45];
          } else {
            vErrors.push(err45);
          }
          errors++;
        }
      }
      if (data.handoffContext !== undefined) {
        let data15 = data.handoffContext;
        if (typeof data15 !== 'string' && data15 !== null) {
          const err46 = {
            instancePath: instancePath + '/handoffContext',
            schemaPath: '#/properties/handoffContext/type',
            keyword: 'type',
            params: { type: schema11.properties.handoffContext.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err46];
          } else {
            vErrors.push(err46);
          }
          errors++;
        }
      }
      if (data.handoffHash !== undefined) {
        let data16 = data.handoffHash;
        const _errs28 = errors;
        let valid1 = false;
        const _errs29 = errors;
        if (data16 !== null) {
          const err47 = {
            instancePath: instancePath + '/handoffHash',
            schemaPath: '#/properties/handoffHash/anyOf/0/type',
            keyword: 'type',
            params: { type: 'null' },
            message: 'must be null',
          };
          if (vErrors === null) {
            vErrors = [err47];
          } else {
            vErrors.push(err47);
          }
          errors++;
        }
        var _valid0 = _errs29 === errors;
        valid1 = valid1 || _valid0;
        if (!valid1) {
          const _errs31 = errors;
          if (typeof data16 === 'string') {
            if (!pattern0.test(data16)) {
              const err48 = {
                instancePath: instancePath + '/handoffHash',
                schemaPath: '#/properties/handoffHash/anyOf/1/pattern',
                keyword: 'pattern',
                params: { pattern: '^[a-f0-9]{64}$' },
                message: 'must match pattern "' + '^[a-f0-9]{64}$' + '"',
              };
              if (vErrors === null) {
                vErrors = [err48];
              } else {
                vErrors.push(err48);
              }
              errors++;
            }
          } else {
            const err49 = {
              instancePath: instancePath + '/handoffHash',
              schemaPath: '#/properties/handoffHash/anyOf/1/type',
              keyword: 'type',
              params: { type: 'string' },
              message: 'must be string',
            };
            if (vErrors === null) {
              vErrors = [err49];
            } else {
              vErrors.push(err49);
            }
            errors++;
          }
          var _valid0 = _errs31 === errors;
          valid1 = valid1 || _valid0;
        }
        if (!valid1) {
          const err50 = {
            instancePath: instancePath + '/handoffHash',
            schemaPath: '#/properties/handoffHash/anyOf',
            keyword: 'anyOf',
            params: {},
            message: 'must match a schema in anyOf',
          };
          if (vErrors === null) {
            vErrors = [err50];
          } else {
            vErrors.push(err50);
          }
          errors++;
        } else {
          errors = _errs28;
          if (vErrors !== null) {
            if (_errs28) {
              vErrors.length = _errs28;
            } else {
              vErrors = null;
            }
          }
        }
      }
      if (data.isolation !== undefined) {
        let data17 = data.isolation;
        if (!(
          data17 === null ||
          data17 === 'current' ||
          data17 === 'branch' ||
          data17 === 'worktree'
        )) {
          const err51 = {
            instancePath: instancePath + '/isolation',
            schemaPath: '#/properties/isolation/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.isolation.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err51];
          } else {
            vErrors.push(err51);
          }
          errors++;
        }
      }
      if (data.language !== undefined) {
        let data18 = data.language;
        if (!(data18 === null || data18 === 'en' || data18 === 'zh-CN')) {
          const err52 = {
            instancePath: instancePath + '/language',
            schemaPath: '#/properties/language/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.language.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err52];
          } else {
            vErrors.push(err52);
          }
          errors++;
        }
      }
      if (data.phase !== undefined) {
        let data19 = data.phase;
        if (!(
          data19 === 'open' ||
          data19 === 'design' ||
          data19 === 'build' ||
          data19 === 'verify' ||
          data19 === 'archive'
        )) {
          const err53 = {
            instancePath: instancePath + '/phase',
            schemaPath: '#/properties/phase/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.phase.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err53];
          } else {
            vErrors.push(err53);
          }
          errors++;
        }
      }
      if (data.plan !== undefined) {
        let data20 = data.plan;
        if (typeof data20 !== 'string' && data20 !== null) {
          const err54 = {
            instancePath: instancePath + '/plan',
            schemaPath: '#/properties/plan/type',
            keyword: 'type',
            params: { type: schema11.properties.plan.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err54];
          } else {
            vErrors.push(err54);
          }
          errors++;
        }
      }
      if (data.reviewMode !== undefined) {
        let data21 = data.reviewMode;
        if (!(
          data21 === null ||
          data21 === 'off' ||
          data21 === 'standard' ||
          data21 === 'thorough'
        )) {
          const err55 = {
            instancePath: instancePath + '/reviewMode',
            schemaPath: '#/properties/reviewMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.reviewMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err55];
          } else {
            vErrors.push(err55);
          }
          errors++;
        }
      }
      if (data.subagentDispatch !== undefined) {
        let data22 = data.subagentDispatch;
        if (!(data22 === null || data22 === 'confirmed')) {
          const err56 = {
            instancePath: instancePath + '/subagentDispatch',
            schemaPath: '#/properties/subagentDispatch/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.subagentDispatch.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err56];
          } else {
            vErrors.push(err56);
          }
          errors++;
        }
      }
      if (data.tddMode !== undefined) {
        let data23 = data.tddMode;
        if (!(data23 === null || data23 === 'tdd' || data23 === 'direct')) {
          const err57 = {
            instancePath: instancePath + '/tddMode',
            schemaPath: '#/properties/tddMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.tddMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err57];
          } else {
            vErrors.push(err57);
          }
          errors++;
        }
      }
      if (data.verificationReport !== undefined) {
        let data24 = data.verificationReport;
        if (typeof data24 !== 'string' && data24 !== null) {
          const err58 = {
            instancePath: instancePath + '/verificationReport',
            schemaPath: '#/properties/verificationReport/type',
            keyword: 'type',
            params: { type: schema11.properties.verificationReport.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err58];
          } else {
            vErrors.push(err58);
          }
          errors++;
        }
      }
      if (data.verifiedAt !== undefined) {
        let data25 = data.verifiedAt;
        if (typeof data25 !== 'string' && data25 !== null) {
          const err59 = {
            instancePath: instancePath + '/verifiedAt',
            schemaPath: '#/properties/verifiedAt/type',
            keyword: 'type',
            params: { type: schema11.properties.verifiedAt.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err59];
          } else {
            vErrors.push(err59);
          }
          errors++;
        }
      }
      if (data.verifyFailures !== undefined) {
        let data26 = data.verifyFailures;
        if (!(typeof data26 == 'number' && !(data26 % 1) && !isNaN(data26) && isFinite(data26))) {
          const err60 = {
            instancePath: instancePath + '/verifyFailures',
            schemaPath: '#/properties/verifyFailures/type',
            keyword: 'type',
            params: { type: 'integer' },
            message: 'must be integer',
          };
          if (vErrors === null) {
            vErrors = [err60];
          } else {
            vErrors.push(err60);
          }
          errors++;
        }
        if (typeof data26 == 'number' && isFinite(data26)) {
          if (data26 < 0 || isNaN(data26)) {
            const err61 = {
              instancePath: instancePath + '/verifyFailures',
              schemaPath: '#/properties/verifyFailures/minimum',
              keyword: 'minimum',
              params: { comparison: '>=', limit: 0 },
              message: 'must be >= 0',
            };
            if (vErrors === null) {
              vErrors = [err61];
            } else {
              vErrors.push(err61);
            }
            errors++;
          }
        }
      }
      if (data.verifyMode !== undefined) {
        let data27 = data.verifyMode;
        if (!(data27 === null || data27 === 'light' || data27 === 'full')) {
          const err62 = {
            instancePath: instancePath + '/verifyMode',
            schemaPath: '#/properties/verifyMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.verifyMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err62];
          } else {
            vErrors.push(err62);
          }
          errors++;
        }
      }
      if (data.verifyResult !== undefined) {
        let data28 = data.verifyResult;
        if (!(data28 === 'pending' || data28 === 'pass' || data28 === 'fail')) {
          const err63 = {
            instancePath: instancePath + '/verifyResult',
            schemaPath: '#/properties/verifyResult/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.verifyResult.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err63];
          } else {
            vErrors.push(err63);
          }
          errors++;
        }
      }
      if (data.workflow !== undefined) {
        let data29 = data.workflow;
        if (!(data29 === 'tweak' || data29 === 'full')) {
          const err64 = {
            instancePath: instancePath + '/workflow',
            schemaPath: '#/properties/workflow/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.workflow.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err64];
          } else {
            vErrors.push(err64);
          }
          errors++;
        }
      }
    } else {
      const err65 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err65];
      } else {
        vErrors.push(err65);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator4 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    additionalProperties: false,
    properties: { archiveDirectory: { minLength: 1, type: 'string' } },
    required: ['archiveDirectory'],
    type: 'object',
  };
  const func2 = __helper0.default ?? __helper0;
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.archiveDirectory === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'archiveDirectory' },
          message: "must have required property '" + 'archiveDirectory' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      for (const key0 in data) {
        if (!(key0 === 'archiveDirectory')) {
          const err1 = {
            instancePath,
            schemaPath: '#/additionalProperties',
            keyword: 'additionalProperties',
            params: { additionalProperty: key0 },
            message: 'must NOT have additional properties',
          };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
      }
      if (data.archiveDirectory !== undefined) {
        let data0 = data.archiveDirectory;
        if (typeof data0 === 'string') {
          if (func2(data0) < 1) {
            const err2 = {
              instancePath: instancePath + '/archiveDirectory',
              schemaPath: '#/properties/archiveDirectory/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
        } else {
          const err3 = {
            instancePath: instancePath + '/archiveDirectory',
            schemaPath: '#/properties/archiveDirectory/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      }
    } else {
      const err4 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator5 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    additionalProperties: false,
    properties: {
      baseCommit: { pattern: '^[0-9a-f]{40}(?:[0-9a-f]{24})?$', type: 'string' },
      deliveryAction: { enum: ['local', 'push', 'pr'] },
      prBaseBranch: { minLength: 1, type: 'string' },
      remote: { minLength: 1, type: 'string' },
      remoteIdentity: { pattern: '^[0-9a-f]{64}$', type: 'string' },
      targetBranch: { minLength: 1, type: 'string' },
      verifiedBranch: { minLength: 1, type: 'string' },
    },
    required: ['deliveryAction', 'targetBranch', 'verifiedBranch', 'baseCommit'],
    type: 'object',
  };
  const pattern0 = new RegExp('^[0-9a-f]{40}(?:[0-9a-f]{24})?$', 'u');
  const pattern1 = new RegExp('^[0-9a-f]{64}$', 'u');
  const func2 = __helper0.default ?? __helper0;
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.deliveryAction === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'deliveryAction' },
          message: "must have required property '" + 'deliveryAction' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      if (data.targetBranch === undefined) {
        const err1 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'targetBranch' },
          message: "must have required property '" + 'targetBranch' + "'",
        };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
      if (data.verifiedBranch === undefined) {
        const err2 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'verifiedBranch' },
          message: "must have required property '" + 'verifiedBranch' + "'",
        };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      if (data.baseCommit === undefined) {
        const err3 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'baseCommit' },
          message: "must have required property '" + 'baseCommit' + "'",
        };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
      for (const key0 in data) {
        if (!(
          key0 === 'baseCommit' ||
          key0 === 'deliveryAction' ||
          key0 === 'prBaseBranch' ||
          key0 === 'remote' ||
          key0 === 'remoteIdentity' ||
          key0 === 'targetBranch' ||
          key0 === 'verifiedBranch'
        )) {
          const err4 = {
            instancePath,
            schemaPath: '#/additionalProperties',
            keyword: 'additionalProperties',
            params: { additionalProperty: key0 },
            message: 'must NOT have additional properties',
          };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      }
      if (data.baseCommit !== undefined) {
        let data0 = data.baseCommit;
        if (typeof data0 === 'string') {
          if (!pattern0.test(data0)) {
            const err5 = {
              instancePath: instancePath + '/baseCommit',
              schemaPath: '#/properties/baseCommit/pattern',
              keyword: 'pattern',
              params: { pattern: '^[0-9a-f]{40}(?:[0-9a-f]{24})?$' },
              message: 'must match pattern "' + '^[0-9a-f]{40}(?:[0-9a-f]{24})?$' + '"',
            };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        } else {
          const err6 = {
            instancePath: instancePath + '/baseCommit',
            schemaPath: '#/properties/baseCommit/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      }
      if (data.deliveryAction !== undefined) {
        let data1 = data.deliveryAction;
        if (!(data1 === 'local' || data1 === 'push' || data1 === 'pr')) {
          const err7 = {
            instancePath: instancePath + '/deliveryAction',
            schemaPath: '#/properties/deliveryAction/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.deliveryAction.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      }
      if (data.prBaseBranch !== undefined) {
        let data2 = data.prBaseBranch;
        if (typeof data2 === 'string') {
          if (func2(data2) < 1) {
            const err8 = {
              instancePath: instancePath + '/prBaseBranch',
              schemaPath: '#/properties/prBaseBranch/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
        } else {
          const err9 = {
            instancePath: instancePath + '/prBaseBranch',
            schemaPath: '#/properties/prBaseBranch/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
      }
      if (data.remote !== undefined) {
        let data3 = data.remote;
        if (typeof data3 === 'string') {
          if (func2(data3) < 1) {
            const err10 = {
              instancePath: instancePath + '/remote',
              schemaPath: '#/properties/remote/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err10];
            } else {
              vErrors.push(err10);
            }
            errors++;
          }
        } else {
          const err11 = {
            instancePath: instancePath + '/remote',
            schemaPath: '#/properties/remote/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      }
      if (data.remoteIdentity !== undefined) {
        let data4 = data.remoteIdentity;
        if (typeof data4 === 'string') {
          if (!pattern1.test(data4)) {
            const err12 = {
              instancePath: instancePath + '/remoteIdentity',
              schemaPath: '#/properties/remoteIdentity/pattern',
              keyword: 'pattern',
              params: { pattern: '^[0-9a-f]{64}$' },
              message: 'must match pattern "' + '^[0-9a-f]{64}$' + '"',
            };
            if (vErrors === null) {
              vErrors = [err12];
            } else {
              vErrors.push(err12);
            }
            errors++;
          }
        } else {
          const err13 = {
            instancePath: instancePath + '/remoteIdentity',
            schemaPath: '#/properties/remoteIdentity/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err13];
          } else {
            vErrors.push(err13);
          }
          errors++;
        }
      }
      if (data.targetBranch !== undefined) {
        let data5 = data.targetBranch;
        if (typeof data5 === 'string') {
          if (func2(data5) < 1) {
            const err14 = {
              instancePath: instancePath + '/targetBranch',
              schemaPath: '#/properties/targetBranch/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err14];
            } else {
              vErrors.push(err14);
            }
            errors++;
          }
        } else {
          const err15 = {
            instancePath: instancePath + '/targetBranch',
            schemaPath: '#/properties/targetBranch/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err15];
          } else {
            vErrors.push(err15);
          }
          errors++;
        }
      }
      if (data.verifiedBranch !== undefined) {
        let data6 = data.verifiedBranch;
        if (typeof data6 === 'string') {
          if (func2(data6) < 1) {
            const err16 = {
              instancePath: instancePath + '/verifiedBranch',
              schemaPath: '#/properties/verifiedBranch/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err16];
            } else {
              vErrors.push(err16);
            }
            errors++;
          }
        } else {
          const err17 = {
            instancePath: instancePath + '/verifiedBranch',
            schemaPath: '#/properties/verifiedBranch/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err17];
          } else {
            vErrors.push(err17);
          }
          errors++;
        }
      }
    } else {
      const err18 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err18];
      } else {
        vErrors.push(err18);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator6 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    additionalProperties: false,
    properties: {
      boundBranch: { type: ['string', 'null'] },
      buildMode: {
        enum: ['subagent-driven-development', 'executing-plans', 'direct', 'autonomous'],
      },
      directOverride: { type: 'boolean' },
      isolation: { enum: ['current', 'branch', 'worktree'] },
      reviewMode: { enum: ['off', 'standard', 'thorough'] },
      subagentDispatch: { enum: ['confirmed', null] },
      tddMode: { enum: ['tdd', 'direct'] },
    },
    required: ['buildMode', 'tddMode', 'reviewMode', 'isolation'],
    type: 'object',
  };
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.buildMode === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'buildMode' },
          message: "must have required property '" + 'buildMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      if (data.tddMode === undefined) {
        const err1 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'tddMode' },
          message: "must have required property '" + 'tddMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
      if (data.reviewMode === undefined) {
        const err2 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'reviewMode' },
          message: "must have required property '" + 'reviewMode' + "'",
        };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      if (data.isolation === undefined) {
        const err3 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'isolation' },
          message: "must have required property '" + 'isolation' + "'",
        };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
      for (const key0 in data) {
        if (!(
          key0 === 'boundBranch' ||
          key0 === 'buildMode' ||
          key0 === 'directOverride' ||
          key0 === 'isolation' ||
          key0 === 'reviewMode' ||
          key0 === 'subagentDispatch' ||
          key0 === 'tddMode'
        )) {
          const err4 = {
            instancePath,
            schemaPath: '#/additionalProperties',
            keyword: 'additionalProperties',
            params: { additionalProperty: key0 },
            message: 'must NOT have additional properties',
          };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      }
      if (data.boundBranch !== undefined) {
        let data0 = data.boundBranch;
        if (typeof data0 !== 'string' && data0 !== null) {
          const err5 = {
            instancePath: instancePath + '/boundBranch',
            schemaPath: '#/properties/boundBranch/type',
            keyword: 'type',
            params: { type: schema11.properties.boundBranch.type },
            message: 'must be string,null',
          };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
      }
      if (data.buildMode !== undefined) {
        let data1 = data.buildMode;
        if (!(
          data1 === 'subagent-driven-development' ||
          data1 === 'executing-plans' ||
          data1 === 'direct' ||
          data1 === 'autonomous'
        )) {
          const err6 = {
            instancePath: instancePath + '/buildMode',
            schemaPath: '#/properties/buildMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.buildMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      }
      if (data.directOverride !== undefined) {
        if (typeof data.directOverride !== 'boolean') {
          const err7 = {
            instancePath: instancePath + '/directOverride',
            schemaPath: '#/properties/directOverride/type',
            keyword: 'type',
            params: { type: 'boolean' },
            message: 'must be boolean',
          };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      }
      if (data.isolation !== undefined) {
        let data3 = data.isolation;
        if (!(data3 === 'current' || data3 === 'branch' || data3 === 'worktree')) {
          const err8 = {
            instancePath: instancePath + '/isolation',
            schemaPath: '#/properties/isolation/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.isolation.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      }
      if (data.reviewMode !== undefined) {
        let data4 = data.reviewMode;
        if (!(data4 === 'off' || data4 === 'standard' || data4 === 'thorough')) {
          const err9 = {
            instancePath: instancePath + '/reviewMode',
            schemaPath: '#/properties/reviewMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.reviewMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
      }
      if (data.subagentDispatch !== undefined) {
        let data5 = data.subagentDispatch;
        if (!(data5 === 'confirmed' || data5 === null)) {
          const err10 = {
            instancePath: instancePath + '/subagentDispatch',
            schemaPath: '#/properties/subagentDispatch/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.subagentDispatch.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      }
      if (data.tddMode !== undefined) {
        let data6 = data.tddMode;
        if (!(data6 === 'tdd' || data6 === 'direct')) {
          const err11 = {
            instancePath: instancePath + '/tddMode',
            schemaPath: '#/properties/tddMode/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.tddMode.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
      }
    } else {
      const err12 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err12];
      } else {
        vErrors.push(err12);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator7 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    additionalProperties: false,
    properties: { contentHash: { pattern: '^[a-f0-9]{64}$', type: 'string' } },
    required: ['contentHash'],
    type: 'object',
  };
  const pattern0 = new RegExp('^[a-f0-9]{64}$', 'u');
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.contentHash === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'contentHash' },
          message: "must have required property '" + 'contentHash' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      for (const key0 in data) {
        if (!(key0 === 'contentHash')) {
          const err1 = {
            instancePath,
            schemaPath: '#/additionalProperties',
            keyword: 'additionalProperties',
            params: { additionalProperty: key0 },
            message: 'must NOT have additional properties',
          };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
      }
      if (data.contentHash !== undefined) {
        let data0 = data.contentHash;
        if (typeof data0 === 'string') {
          if (!pattern0.test(data0)) {
            const err2 = {
              instancePath: instancePath + '/contentHash',
              schemaPath: '#/properties/contentHash/pattern',
              keyword: 'pattern',
              params: { pattern: '^[a-f0-9]{64}$' },
              message: 'must match pattern "' + '^[a-f0-9]{64}$' + '"',
            };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
        } else {
          const err3 = {
            instancePath: instancePath + '/contentHash',
            schemaPath: '#/properties/contentHash/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      }
    } else {
      const err4 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator8 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    additionalProperties: false,
    properties: {
      event: { enum: ['build-complete', 'escalation-requested'] },
      proposal: { minLength: 1, type: 'string' },
    },
    required: ['event'],
    type: 'object',
  };
  const func2 = __helper0.default ?? __helper0;
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.event === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'event' },
          message: "must have required property '" + 'event' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      for (const key0 in data) {
        if (!(key0 === 'event' || key0 === 'proposal')) {
          const err1 = {
            instancePath,
            schemaPath: '#/additionalProperties',
            keyword: 'additionalProperties',
            params: { additionalProperty: key0 },
            message: 'must NOT have additional properties',
          };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
      }
      if (data.event !== undefined) {
        let data0 = data.event;
        if (!(data0 === 'build-complete' || data0 === 'escalation-requested')) {
          const err2 = {
            instancePath: instancePath + '/event',
            schemaPath: '#/properties/event/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.event.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
      }
      if (data.proposal !== undefined) {
        let data1 = data.proposal;
        if (typeof data1 === 'string') {
          if (func2(data1) < 1) {
            const err3 = {
              instancePath: instancePath + '/proposal',
              schemaPath: '#/properties/proposal/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        } else {
          const err4 = {
            instancePath: instancePath + '/proposal',
            schemaPath: '#/properties/proposal/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      }
    } else {
      const err5 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err5];
      } else {
        vErrors.push(err5);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator9 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    additionalProperties: false,
    properties: {
      event: { enum: ['verification-ready', 'verify-fail'] },
      reason: { minLength: 1, type: 'string' },
      verificationReport: { minLength: 1, type: 'string' },
    },
    required: ['event'],
    type: 'object',
  };
  const func2 = __helper0.default ?? __helper0;
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.event === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'event' },
          message: "must have required property '" + 'event' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      for (const key0 in data) {
        if (!(key0 === 'event' || key0 === 'reason' || key0 === 'verificationReport')) {
          const err1 = {
            instancePath,
            schemaPath: '#/additionalProperties',
            keyword: 'additionalProperties',
            params: { additionalProperty: key0 },
            message: 'must NOT have additional properties',
          };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
      }
      if (data.event !== undefined) {
        let data0 = data.event;
        if (!(data0 === 'verification-ready' || data0 === 'verify-fail')) {
          const err2 = {
            instancePath: instancePath + '/event',
            schemaPath: '#/properties/event/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.event.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
      }
      if (data.reason !== undefined) {
        let data1 = data.reason;
        if (typeof data1 === 'string') {
          if (func2(data1) < 1) {
            const err3 = {
              instancePath: instancePath + '/reason',
              schemaPath: '#/properties/reason/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        } else {
          const err4 = {
            instancePath: instancePath + '/reason',
            schemaPath: '#/properties/reason/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      }
      if (data.verificationReport !== undefined) {
        let data2 = data.verificationReport;
        if (typeof data2 === 'string') {
          if (func2(data2) < 1) {
            const err5 = {
              instancePath: instancePath + '/verificationReport',
              schemaPath: '#/properties/verificationReport/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        } else {
          const err6 = {
            instancePath: instancePath + '/verificationReport',
            schemaPath: '#/properties/verificationReport/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      }
    } else {
      const err7 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator10 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    additionalProperties: false,
    properties: {
      prBaseBranch: { minLength: 1, type: 'string' },
      remote: { minLength: 1, type: 'string' },
      summary: { minLength: 1, type: 'string' },
      targetBranch: { minLength: 1, type: 'string' },
    },
    required: ['targetBranch', 'summary'],
    type: 'object',
  };
  const func2 = __helper0.default ?? __helper0;
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.targetBranch === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'targetBranch' },
          message: "must have required property '" + 'targetBranch' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      if (data.summary === undefined) {
        const err1 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'summary' },
          message: "must have required property '" + 'summary' + "'",
        };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
      for (const key0 in data) {
        if (!(
          key0 === 'prBaseBranch' ||
          key0 === 'remote' ||
          key0 === 'summary' ||
          key0 === 'targetBranch'
        )) {
          const err2 = {
            instancePath,
            schemaPath: '#/additionalProperties',
            keyword: 'additionalProperties',
            params: { additionalProperty: key0 },
            message: 'must NOT have additional properties',
          };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
      }
      if (data.prBaseBranch !== undefined) {
        let data0 = data.prBaseBranch;
        if (typeof data0 === 'string') {
          if (func2(data0) < 1) {
            const err3 = {
              instancePath: instancePath + '/prBaseBranch',
              schemaPath: '#/properties/prBaseBranch/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        } else {
          const err4 = {
            instancePath: instancePath + '/prBaseBranch',
            schemaPath: '#/properties/prBaseBranch/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      }
      if (data.remote !== undefined) {
        let data1 = data.remote;
        if (typeof data1 === 'string') {
          if (func2(data1) < 1) {
            const err5 = {
              instancePath: instancePath + '/remote',
              schemaPath: '#/properties/remote/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        } else {
          const err6 = {
            instancePath: instancePath + '/remote',
            schemaPath: '#/properties/remote/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      }
      if (data.summary !== undefined) {
        let data2 = data.summary;
        if (typeof data2 === 'string') {
          if (func2(data2) < 1) {
            const err7 = {
              instancePath: instancePath + '/summary',
              schemaPath: '#/properties/summary/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err7];
            } else {
              vErrors.push(err7);
            }
            errors++;
          }
        } else {
          const err8 = {
            instancePath: instancePath + '/summary',
            schemaPath: '#/properties/summary/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
      }
      if (data.targetBranch !== undefined) {
        let data3 = data.targetBranch;
        if (typeof data3 === 'string') {
          if (func2(data3) < 1) {
            const err9 = {
              instancePath: instancePath + '/targetBranch',
              schemaPath: '#/properties/targetBranch/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        } else {
          const err10 = {
            instancePath: instancePath + '/targetBranch',
            schemaPath: '#/properties/targetBranch/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
      }
    } else {
      const err11 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err11];
      } else {
        vErrors.push(err11);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator11 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    properties: { buildPause: { enum: ['plan-ready'] }, plan: { minLength: 1, type: 'string' } },
    required: ['plan'],
    type: 'object',
  };
  const func2 = __helper0.default ?? __helper0;
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.plan === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'plan' },
          message: "must have required property '" + 'plan' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      if (data.buildPause !== undefined) {
        if (!(data.buildPause === 'plan-ready')) {
          const err1 = {
            instancePath: instancePath + '/buildPause',
            schemaPath: '#/properties/buildPause/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.buildPause.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
      }
      if (data.plan !== undefined) {
        let data1 = data.plan;
        if (typeof data1 === 'string') {
          if (func2(data1) < 1) {
            const err2 = {
              instancePath: instancePath + '/plan',
              schemaPath: '#/properties/plan/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
        } else {
          const err3 = {
            instancePath: instancePath + '/plan',
            schemaPath: '#/properties/plan/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
      }
    } else {
      const err4 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err4];
      } else {
        vErrors.push(err4);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator12 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    properties: {
      contentHash: { pattern: '^[a-f0-9]{64}$', type: 'string' },
      receiptRef: { minLength: 1, type: 'string' },
      scope: { enum: ['build'] },
    },
    required: ['scope', 'receiptRef', 'contentHash'],
    type: 'object',
  };
  const pattern0 = new RegExp('^[a-f0-9]{64}$', 'u');
  const func2 = __helper0.default ?? __helper0;
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.scope === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'scope' },
          message: "must have required property '" + 'scope' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      if (data.receiptRef === undefined) {
        const err1 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'receiptRef' },
          message: "must have required property '" + 'receiptRef' + "'",
        };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
      if (data.contentHash === undefined) {
        const err2 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'contentHash' },
          message: "must have required property '" + 'contentHash' + "'",
        };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      if (data.contentHash !== undefined) {
        let data0 = data.contentHash;
        if (typeof data0 === 'string') {
          if (!pattern0.test(data0)) {
            const err3 = {
              instancePath: instancePath + '/contentHash',
              schemaPath: '#/properties/contentHash/pattern',
              keyword: 'pattern',
              params: { pattern: '^[a-f0-9]{64}$' },
              message: 'must match pattern "' + '^[a-f0-9]{64}$' + '"',
            };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        } else {
          const err4 = {
            instancePath: instancePath + '/contentHash',
            schemaPath: '#/properties/contentHash/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      }
      if (data.receiptRef !== undefined) {
        let data1 = data.receiptRef;
        if (typeof data1 === 'string') {
          if (func2(data1) < 1) {
            const err5 = {
              instancePath: instancePath + '/receiptRef',
              schemaPath: '#/properties/receiptRef/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        } else {
          const err6 = {
            instancePath: instancePath + '/receiptRef',
            schemaPath: '#/properties/receiptRef/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      }
      if (data.scope !== undefined) {
        if (!(data.scope === 'build')) {
          const err7 = {
            instancePath: instancePath + '/scope',
            schemaPath: '#/properties/scope/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.scope.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      }
    } else {
      const err8 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator13 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    properties: {
      contentHash: { pattern: '^[a-f0-9]{64}$', type: 'string' },
      receiptRef: { minLength: 1, type: 'string' },
      scope: { enum: ['verify'] },
    },
    required: ['scope', 'receiptRef', 'contentHash'],
    type: 'object',
  };
  const pattern0 = new RegExp('^[a-f0-9]{64}$', 'u');
  const func2 = __helper0.default ?? __helper0;
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.scope === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'scope' },
          message: "must have required property '" + 'scope' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      if (data.receiptRef === undefined) {
        const err1 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'receiptRef' },
          message: "must have required property '" + 'receiptRef' + "'",
        };
        if (vErrors === null) {
          vErrors = [err1];
        } else {
          vErrors.push(err1);
        }
        errors++;
      }
      if (data.contentHash === undefined) {
        const err2 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'contentHash' },
          message: "must have required property '" + 'contentHash' + "'",
        };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      if (data.contentHash !== undefined) {
        let data0 = data.contentHash;
        if (typeof data0 === 'string') {
          if (!pattern0.test(data0)) {
            const err3 = {
              instancePath: instancePath + '/contentHash',
              schemaPath: '#/properties/contentHash/pattern',
              keyword: 'pattern',
              params: { pattern: '^[a-f0-9]{64}$' },
              message: 'must match pattern "' + '^[a-f0-9]{64}$' + '"',
            };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        } else {
          const err4 = {
            instancePath: instancePath + '/contentHash',
            schemaPath: '#/properties/contentHash/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      }
      if (data.receiptRef !== undefined) {
        let data1 = data.receiptRef;
        if (typeof data1 === 'string') {
          if (func2(data1) < 1) {
            const err5 = {
              instancePath: instancePath + '/receiptRef',
              schemaPath: '#/properties/receiptRef/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        } else {
          const err6 = {
            instancePath: instancePath + '/receiptRef',
            schemaPath: '#/properties/receiptRef/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      }
      if (data.scope !== undefined) {
        if (!(data.scope === 'verify')) {
          const err7 = {
            instancePath: instancePath + '/scope',
            schemaPath: '#/properties/scope/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.scope.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
      }
    } else {
      const err8 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err8];
      } else {
        vErrors.push(err8);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator14 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    properties: { designDoc: { minLength: 1, type: 'string' } },
    required: ['designDoc'],
    type: 'object',
  };
  const func2 = __helper0.default ?? __helper0;
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.designDoc === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'designDoc' },
          message: "must have required property '" + 'designDoc' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      if (data.designDoc !== undefined) {
        let data0 = data.designDoc;
        if (typeof data0 === 'string') {
          if (func2(data0) < 1) {
            const err1 = {
              instancePath: instancePath + '/designDoc',
              schemaPath: '#/properties/designDoc/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err1];
            } else {
              vErrors.push(err1);
            }
            errors++;
          }
        } else {
          const err2 = {
            instancePath: instancePath + '/designDoc',
            schemaPath: '#/properties/designDoc/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
      }
    } else {
      const err3 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err3];
      } else {
        vErrors.push(err3);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator15 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    properties: { event: { enum: ['build-complete'] } },
    required: ['event'],
    type: 'object',
  };
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.event === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'event' },
          message: "must have required property '" + 'event' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      if (data.event !== undefined) {
        if (!(data.event === 'build-complete')) {
          const err1 = {
            instancePath: instancePath + '/event',
            schemaPath: '#/properties/event/enum',
            keyword: 'enum',
            params: { allowedValues: schema11.properties.event.enum },
            message: 'must be equal to one of the allowed values',
          };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
      }
    } else {
      const err2 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err2];
      } else {
        vErrors.push(err2);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
const validator16 = (() => {
  const module = { exports: {} };
  ('use strict');
  module.exports = validate10;
  module.exports.default = validate10;
  const schema11 = {
    properties: {
      handoffContext: { minLength: 1, type: 'string' },
      handoffHash: { pattern: '^[a-f0-9]{64}$', type: 'string' },
      proposal: { minLength: 1, type: 'string' },
    },
    required: ['proposal'],
    type: 'object',
  };
  const func2 = __helper0.default ?? __helper0;
  const pattern0 = new RegExp('^[a-f0-9]{64}$', 'u');
  function validate10(
    data,
    { instancePath = '', parentData, parentDataProperty, rootData = data } = {},
  ) {
    let vErrors = null;
    let errors = 0;
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      if (data.proposal === undefined) {
        const err0 = {
          instancePath,
          schemaPath: '#/required',
          keyword: 'required',
          params: { missingProperty: 'proposal' },
          message: "must have required property '" + 'proposal' + "'",
        };
        if (vErrors === null) {
          vErrors = [err0];
        } else {
          vErrors.push(err0);
        }
        errors++;
      }
      if (data.handoffContext !== undefined) {
        let data0 = data.handoffContext;
        if (typeof data0 === 'string') {
          if (func2(data0) < 1) {
            const err1 = {
              instancePath: instancePath + '/handoffContext',
              schemaPath: '#/properties/handoffContext/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err1];
            } else {
              vErrors.push(err1);
            }
            errors++;
          }
        } else {
          const err2 = {
            instancePath: instancePath + '/handoffContext',
            schemaPath: '#/properties/handoffContext/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
      }
      if (data.handoffHash !== undefined) {
        let data1 = data.handoffHash;
        if (typeof data1 === 'string') {
          if (!pattern0.test(data1)) {
            const err3 = {
              instancePath: instancePath + '/handoffHash',
              schemaPath: '#/properties/handoffHash/pattern',
              keyword: 'pattern',
              params: { pattern: '^[a-f0-9]{64}$' },
              message: 'must match pattern "' + '^[a-f0-9]{64}$' + '"',
            };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        } else {
          const err4 = {
            instancePath: instancePath + '/handoffHash',
            schemaPath: '#/properties/handoffHash/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
      }
      if (data.proposal !== undefined) {
        let data2 = data.proposal;
        if (typeof data2 === 'string') {
          if (func2(data2) < 1) {
            const err5 = {
              instancePath: instancePath + '/proposal',
              schemaPath: '#/properties/proposal/minLength',
              keyword: 'minLength',
              params: { limit: 1 },
              message: 'must NOT have fewer than 1 characters',
            };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        } else {
          const err6 = {
            instancePath: instancePath + '/proposal',
            schemaPath: '#/properties/proposal/type',
            keyword: 'type',
            params: { type: 'string' },
            message: 'must be string',
          };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
      }
    } else {
      const err7 = {
        instancePath,
        schemaPath: '#/type',
        keyword: 'type',
        params: { type: 'object' },
        message: 'must be object',
      };
      if (vErrors === null) {
        vErrors = [err7];
      } else {
        vErrors.push(err7);
      }
      errors++;
    }
    validate10.errors = vErrors;
    return errors === 0;
  }
  return module.exports;
})();
export const precompiledRuntimeSchemas = new Map([
  [
    '{"additionalProperties":false,"properties":{"action":{"enum":["local","push","pr"]},"commit":{"pattern":"^[0-9a-f]{40}(?:[0-9a-f]{24})?$","type":"string"},"prUrl":{"minLength":1,"type":"string"},"remote":{"minLength":1,"type":"string"},"targetBranch":{"minLength":1,"type":"string"}},"required":["action","targetBranch","commit"],"type":"object"}',
    validator0,
  ],
  [
    '{"additionalProperties":false,"properties":{"archiveConfirmation":{"enum":[null,"pending","confirmed"]},"archived":{"type":"boolean"},"autoTransition":{"type":["boolean","null"]},"baseRef":{"type":["string","null"]},"boundBranch":{"type":["string","null"]},"branchStatus":{"enum":[null,"pending","handled"]},"buildMode":{"enum":[null,"subagent-driven-development","executing-plans","direct","autonomous"]},"buildPause":{"enum":[null,"plan-ready"]},"checkEpoch":{"minimum":0,"type":"integer"},"classicMigration":{"enum":[null,1]},"classicProfile":{"enum":[null,"full","hotfix","tweak"]},"contextCompression":{"enum":[null,"off","beta"]},"createdAt":{"type":["string","null"]},"designDoc":{"type":["string","null"]},"directOverride":{"type":["boolean","null"]},"handoffContext":{"type":["string","null"]},"handoffHash":{"anyOf":[{"type":"null"},{"pattern":"^[a-f0-9]{64}$","type":"string"}]},"isolation":{"enum":[null,"current","branch","worktree"]},"language":{"enum":[null,"en","zh-CN"]},"phase":{"enum":["open","design","build","verify","archive"]},"plan":{"type":["string","null"]},"reviewMode":{"enum":[null,"off","standard","thorough"]},"subagentDispatch":{"enum":[null,"confirmed"]},"tddMode":{"enum":[null,"tdd","direct"]},"verificationReport":{"type":["string","null"]},"verifiedAt":{"type":["string","null"]},"verifyFailures":{"minimum":0,"type":"integer"},"verifyMode":{"enum":[null,"light","full"]},"verifyResult":{"enum":["pending","pass","fail"]},"workflow":{"enum":["full"]}},"required":["workflow","language","phase","contextCompression","buildMode","buildPause","subagentDispatch","tddMode","reviewMode","isolation","boundBranch","verifyMode","autoTransition","baseRef","designDoc","plan","verifyResult","verifyFailures","verificationReport","branchStatus","createdAt","verifiedAt","archiveConfirmation","archived","directOverride","handoffContext","handoffHash","classicProfile","classicMigration"],"type":"object"}',
    validator1,
  ],
  [
    '{"additionalProperties":false,"properties":{"archiveConfirmation":{"enum":[null,"pending","confirmed"]},"archived":{"type":"boolean"},"autoTransition":{"type":["boolean","null"]},"baseRef":{"type":["string","null"]},"boundBranch":{"type":["string","null"]},"branchStatus":{"enum":[null,"pending","handled"]},"buildMode":{"enum":[null,"subagent-driven-development","executing-plans","direct","autonomous"]},"buildPause":{"enum":[null,"plan-ready"]},"checkEpoch":{"minimum":0,"type":"integer"},"classicMigration":{"enum":[null,1]},"classicProfile":{"enum":[null,"full","hotfix","tweak"]},"contextCompression":{"enum":[null,"off","beta"]},"createdAt":{"type":["string","null"]},"designDoc":{"type":["string","null"]},"directOverride":{"type":["boolean","null"]},"handoffContext":{"type":["string","null"]},"handoffHash":{"anyOf":[{"type":"null"},{"pattern":"^[a-f0-9]{64}$","type":"string"}]},"isolation":{"enum":[null,"current","branch","worktree"]},"language":{"enum":[null,"en","zh-CN"]},"phase":{"enum":["open","design","build","verify","archive"]},"plan":{"type":["string","null"]},"reviewMode":{"enum":[null,"off","standard","thorough"]},"subagentDispatch":{"enum":[null,"confirmed"]},"tddMode":{"enum":[null,"tdd","direct"]},"verificationReport":{"type":["string","null"]},"verifiedAt":{"type":["string","null"]},"verifyFailures":{"minimum":0,"type":"integer"},"verifyMode":{"enum":[null,"light","full"]},"verifyResult":{"enum":["pending","pass","fail"]},"workflow":{"enum":["hotfix","full"]}},"required":["workflow","language","phase","contextCompression","buildMode","buildPause","subagentDispatch","tddMode","reviewMode","isolation","boundBranch","verifyMode","autoTransition","baseRef","designDoc","plan","verifyResult","verifyFailures","verificationReport","branchStatus","createdAt","verifiedAt","archiveConfirmation","archived","directOverride","handoffContext","handoffHash","classicProfile","classicMigration"],"type":"object"}',
    validator2,
  ],
  [
    '{"additionalProperties":false,"properties":{"archiveConfirmation":{"enum":[null,"pending","confirmed"]},"archived":{"type":"boolean"},"autoTransition":{"type":["boolean","null"]},"baseRef":{"type":["string","null"]},"boundBranch":{"type":["string","null"]},"branchStatus":{"enum":[null,"pending","handled"]},"buildMode":{"enum":[null,"subagent-driven-development","executing-plans","direct","autonomous"]},"buildPause":{"enum":[null,"plan-ready"]},"checkEpoch":{"minimum":0,"type":"integer"},"classicMigration":{"enum":[null,1]},"classicProfile":{"enum":[null,"full","hotfix","tweak"]},"contextCompression":{"enum":[null,"off","beta"]},"createdAt":{"type":["string","null"]},"designDoc":{"type":["string","null"]},"directOverride":{"type":["boolean","null"]},"handoffContext":{"type":["string","null"]},"handoffHash":{"anyOf":[{"type":"null"},{"pattern":"^[a-f0-9]{64}$","type":"string"}]},"isolation":{"enum":[null,"current","branch","worktree"]},"language":{"enum":[null,"en","zh-CN"]},"phase":{"enum":["open","design","build","verify","archive"]},"plan":{"type":["string","null"]},"reviewMode":{"enum":[null,"off","standard","thorough"]},"subagentDispatch":{"enum":[null,"confirmed"]},"tddMode":{"enum":[null,"tdd","direct"]},"verificationReport":{"type":["string","null"]},"verifiedAt":{"type":["string","null"]},"verifyFailures":{"minimum":0,"type":"integer"},"verifyMode":{"enum":[null,"light","full"]},"verifyResult":{"enum":["pending","pass","fail"]},"workflow":{"enum":["tweak","full"]}},"required":["workflow","language","phase","contextCompression","buildMode","buildPause","subagentDispatch","tddMode","reviewMode","isolation","boundBranch","verifyMode","autoTransition","baseRef","designDoc","plan","verifyResult","verifyFailures","verificationReport","branchStatus","createdAt","verifiedAt","archiveConfirmation","archived","directOverride","handoffContext","handoffHash","classicProfile","classicMigration"],"type":"object"}',
    validator3,
  ],
  [
    '{"additionalProperties":false,"properties":{"archiveDirectory":{"minLength":1,"type":"string"}},"required":["archiveDirectory"],"type":"object"}',
    validator4,
  ],
  [
    '{"additionalProperties":false,"properties":{"baseCommit":{"pattern":"^[0-9a-f]{40}(?:[0-9a-f]{24})?$","type":"string"},"deliveryAction":{"enum":["local","push","pr"]},"prBaseBranch":{"minLength":1,"type":"string"},"remote":{"minLength":1,"type":"string"},"remoteIdentity":{"pattern":"^[0-9a-f]{64}$","type":"string"},"targetBranch":{"minLength":1,"type":"string"},"verifiedBranch":{"minLength":1,"type":"string"}},"required":["deliveryAction","targetBranch","verifiedBranch","baseCommit"],"type":"object"}',
    validator5,
  ],
  [
    '{"additionalProperties":false,"properties":{"boundBranch":{"type":["string","null"]},"buildMode":{"enum":["subagent-driven-development","executing-plans","direct","autonomous"]},"directOverride":{"type":"boolean"},"isolation":{"enum":["current","branch","worktree"]},"reviewMode":{"enum":["off","standard","thorough"]},"subagentDispatch":{"enum":["confirmed",null]},"tddMode":{"enum":["tdd","direct"]}},"required":["buildMode","tddMode","reviewMode","isolation"],"type":"object"}',
    validator6,
  ],
  [
    '{"additionalProperties":false,"properties":{"contentHash":{"pattern":"^[a-f0-9]{64}$","type":"string"}},"required":["contentHash"],"type":"object"}',
    validator7,
  ],
  [
    '{"additionalProperties":false,"properties":{"event":{"enum":["build-complete","escalation-requested"]},"proposal":{"minLength":1,"type":"string"}},"required":["event"],"type":"object"}',
    validator8,
  ],
  [
    '{"additionalProperties":false,"properties":{"event":{"enum":["verification-ready","verify-fail"]},"reason":{"minLength":1,"type":"string"},"verificationReport":{"minLength":1,"type":"string"}},"required":["event"],"type":"object"}',
    validator9,
  ],
  [
    '{"additionalProperties":false,"properties":{"prBaseBranch":{"minLength":1,"type":"string"},"remote":{"minLength":1,"type":"string"},"summary":{"minLength":1,"type":"string"},"targetBranch":{"minLength":1,"type":"string"}},"required":["targetBranch","summary"],"type":"object"}',
    validator10,
  ],
  [
    '{"properties":{"buildPause":{"enum":["plan-ready"]},"plan":{"minLength":1,"type":"string"}},"required":["plan"],"type":"object"}',
    validator11,
  ],
  [
    '{"properties":{"contentHash":{"pattern":"^[a-f0-9]{64}$","type":"string"},"receiptRef":{"minLength":1,"type":"string"},"scope":{"enum":["build"]}},"required":["scope","receiptRef","contentHash"],"type":"object"}',
    validator12,
  ],
  [
    '{"properties":{"contentHash":{"pattern":"^[a-f0-9]{64}$","type":"string"},"receiptRef":{"minLength":1,"type":"string"},"scope":{"enum":["verify"]}},"required":["scope","receiptRef","contentHash"],"type":"object"}',
    validator13,
  ],
  [
    '{"properties":{"designDoc":{"minLength":1,"type":"string"}},"required":["designDoc"],"type":"object"}',
    validator14,
  ],
  [
    '{"properties":{"event":{"enum":["build-complete"]}},"required":["event"],"type":"object"}',
    validator15,
  ],
  [
    '{"properties":{"handoffContext":{"minLength":1,"type":"string"},"handoffHash":{"pattern":"^[a-f0-9]{64}$","type":"string"},"proposal":{"minLength":1,"type":"string"}},"required":["proposal"],"type":"object"}',
    validator16,
  ],
]);
