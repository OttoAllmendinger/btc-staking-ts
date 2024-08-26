import { opcodes, script } from "bitcoinjs-lib";

import { Miniscript } from "@bitgo/wasm-miniscript";
import { StakingScripts } from "../types/StakingScripts";
import { miniscript } from "./formatMs";

// PK_LENGTH denotes the length of a public key in bytes
export const PK_LENGTH = 32;

function toBuffer(ms: Miniscript): Buffer {
  return Buffer.from(ms.encode());
}

// StakingScriptData is a class that holds the data required for the BTC Staking Script
// and exposes methods for converting it into useful formats
export class StakingScriptDataMini {
  #stakerKey: Buffer;
  #finalityProviderKeys: Buffer[];
  #covenantKeys: Buffer[];
  #covenantThreshold: number;
  #stakingTimeLock: number;
  #unbondingTimeLock: number;
  #magicBytes: Buffer;

  constructor(
    // The `stakerKey` is the public key of the staker without the coordinate bytes.
    stakerKey: Buffer,
    // A list of public keys without the coordinate bytes corresponding to the finality providers
    // the stake will be delegated to.
    // Currently, Babylon does not support restaking, so this should contain only a single item.
    finalityProviderKeys: Buffer[],
    // A list of the public keys without the coordinate bytes corresponding to
    // the covenant emulators.
    // This is a parameter of the Babylon system and should be retrieved from there.
    covenantKeys: Buffer[],
    // The number of covenant emulator signatures required for a transaction
    // to be valid.
    // This is a parameter of the Babylon system and should be retrieved from there.
    covenantThreshold: number,
    // The staking period denoted as a number of BTC blocks.
    stakingTimelock: number,
    // The unbonding period denoted as a number of BTC blocks.
    // This value should be more than equal than the minimum unbonding time of the
    // Babylon system.
    unbondingTimelock: number,
    // The magic bytes used to identify the staking transaction on Babylon
    // through the data return script
    magicBytes: Buffer,
  ) {
    // Check that required input values are not missing when creating an instance of the StakingScriptData class
    if (
      !stakerKey ||
      !finalityProviderKeys ||
      !covenantKeys ||
      !covenantThreshold ||
      !stakingTimelock ||
      !unbondingTimelock ||
      !magicBytes
    ) {
      throw new Error("Missing required input values");
    }
    this.#stakerKey = stakerKey;
    this.#finalityProviderKeys = finalityProviderKeys;
    this.#covenantKeys = covenantKeys;
    this.#covenantThreshold = covenantThreshold;
    this.#stakingTimeLock = stakingTimelock;
    this.#unbondingTimeLock = unbondingTimelock;
    this.#magicBytes = magicBytes;

    // Run the validate method to check if the provided script data is valid
    if (!this.validate()) {
      throw new Error("Invalid script data provided");
    }
  }

  /**
   * Validates the staking script.
   * @returns {boolean} Returns true if the staking script is valid, otherwise false.
   */
  validate(): boolean {
    // check that staker key is the correct length
    if (this.#stakerKey.length != PK_LENGTH) {
      return false;
    }
    // check that finalityProvider keys are the correct length
    if (
      this.#finalityProviderKeys.some(
        (finalityProviderKey) => finalityProviderKey.length != PK_LENGTH,
      )
    ) {
      return false;
    }
    // check that covenant keys are the correct length
    if (
      this.#covenantKeys.some((covenantKey) => covenantKey.length != PK_LENGTH)
    ) {
      return false;
    }
    // check that maximum value for staking time is not greater than uint16
    if (this.#stakingTimeLock > 65535) {
      return false;
    }
    return true;
  }

  // The staking script allows for multiple finality provider public keys
  // to support (re)stake to multiple finality providers
  // Covenant members are going to have multiple keys

  /**
   * Builds a timelock script.
   * @param timelock - The timelock value to encode in the script.
   * @returns {Buffer} containing the compiled timelock script.
   */
  buildTimelockScript(timelock: number): Buffer {
    return toBuffer(
      miniscript`and_v(v:pk(${this.#stakerKey}),older(${timelock}))`,
    );
  }

  /**
   * Builds the staking timelock script.
   * Only holder of private key for given pubKey can spend after relative lock time
   * @returns {Buffer} The staking timelock script.
   */
  buildStakingTimelockScript(): Buffer {
    return this.buildTimelockScript(this.#stakingTimeLock);
  }

  /**
   * Builds the unbonding timelock script.
   * Creates the unbonding timelock script in the form:
   * @returns {Buffer} The unbonding timelock script.
   */
  buildUnbondingTimelockScript(): Buffer {
    return this.buildTimelockScript(this.#unbondingTimeLock);
  }

  /**
   * @returns {Buffer} The unbonding script.
   */
  buildUnbondingScript(): Buffer {
    return toBuffer(
      miniscript`and_v(
        v:pk(${this.#stakerKey}),
        multi_a(
          ${this.#covenantThreshold},
          ${this.#covenantKeys}
          )
        )`,
    );
  }

  /**
   * The slashing script is a combination of single-key and multi-key scripts.
   * The single-key script is used for staker key verification.
   * The multi-key script is used for finality provider key verification and covenant key verification.
   * @returns {Buffer} The slashing script as a Buffer.
   */
  buildSlashingScript(): Buffer {
    return toBuffer(miniscript`
    and_v(
      and_v(
        v:pk(${this.#stakerKey}),
        ${this.#finalityProviderKeys.map((pk) => `v:pk(${pk.toString("hex")})`)}
      ),
      multi_a(${this.#covenantThreshold},${this.#covenantKeys})
    )`);
  }

  /**
   * Builds a data embed script for staking in the form:
   *    OP_RETURN || <serializedStakingData>
   * where serializedStakingData is the concatenation of:
   *    MagicBytes || Version || StakerPublicKey || FinalityProviderPublicKey || StakingTimeLock
   * @returns {Buffer} The compiled data embed script.
   */
  buildDataEmbedScript(): Buffer {
    // 1 byte for version
    const version = Buffer.alloc(1);
    version.writeUInt8(0);
    // 2 bytes for staking time
    const stakingTimeLock = Buffer.alloc(2);
    // big endian
    stakingTimeLock.writeUInt16BE(this.#stakingTimeLock);
    const serializedStakingData = Buffer.concat([
      this.#magicBytes,
      version,
      this.#stakerKey,
      this.#finalityProviderKeys[0],
      stakingTimeLock,
    ]);
    return script.compile([opcodes.OP_RETURN, serializedStakingData]);
  }

  /**
   * Builds the staking scripts.
   * @returns {StakingScripts} The staking scripts.
   */
  buildScripts(): StakingScripts {
    return {
      timelockScript: this.buildStakingTimelockScript(),
      unbondingScript: this.buildUnbondingScript(),
      slashingScript: this.buildSlashingScript(),
      unbondingTimelockScript: this.buildUnbondingTimelockScript(),
      dataEmbedScript: this.buildDataEmbedScript(),
    };
  }
}
