import * as ecc from "@bitcoin-js/tiny-secp256k1-asmjs";
import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory, { ECPairInterface } from "ecpair";
import { StakingScriptData, stakingTransaction } from "../../src";
import { StakingScripts } from "../../src/types/StakingScripts";
import { UTXO } from "../../src/types/UTXO";

import { Miniscript } from "@bitgo/wasm-miniscript";
import { StakingScriptDataMini } from "../../src/utils/stakingScriptMini";

function assertEqualScripts(a: StakingScripts, b: StakingScripts) {
  function decodeToMs(buffer: Buffer) {
    try {
      return Miniscript.fromBitcoinScript(buffer, "tap").toString();
    } catch (e: unknown) {
      return (e as Error).message;
    }
  }
  if (Object.keys(a).length !== Object.keys(b).length) {
    throw new Error(
      `keys length mismatch: ${Object.keys(a).length} !== ${
        Object.keys(b).length
      }`,
    );
  }
  Object.entries(a).forEach(([key, value]: [string, Buffer]) => {
    const bValue = b[key as keyof StakingScripts];
    if (!bValue) {
      throw new Error(`key ${key} not found in b`);
    }
    if (!value.equals(bValue)) {
      throw new Error(
        [
          `values mismatch for key ${key}: `,
          value.toString("hex"),
          `!==`,
          bValue.toString("hex"),
          `\nms:\n`,
          decodeToMs(value),
          '\n!==\n',
          decodeToMs(bValue),
        ].join(""),
      );
    }
  });
}

function decodeScriptsToMiniscript(scripts: StakingScripts) {
  function mapValue(value: unknown): unknown {
    if (Buffer.isBuffer(value)) {
      try {
        return Miniscript.fromBitcoinScript(value, "tap").toString();
      } catch (e: unknown) {
        return { error: (e as Error).message };
      }
    }

    return {
      error: "Unsupported type",
    };
  }

  const result = Object.entries(scripts).map(([k, v]) => {
    return [k, mapValue(v)];
  });

  require("fs").writeFileSync("scripts.json", JSON.stringify(result, null, 2));
}

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

export const DEFAULT_TEST_FEE_RATE = 10;

export interface KeyPair {
  privateKey: string;
  publicKey: string;
  publicKeyNoCoord: string;
  keyPair: ECPairInterface;
}

class DataGenerator {
  private network: bitcoin.networks.Network;

  constructor(network: bitcoin.networks.Network) {
    this.network = network;
  }

  generateRandomTxId = () => {
    const randomBuffer = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) {
      randomBuffer[i] = Math.floor(Math.random() * 256);
    }
    return randomBuffer.toString("hex");
  };

  generateRandomKeyPair = (): KeyPair => {
    const keyPair = ECPair.makeRandom({ network: this.network });
    const { privateKey, publicKey } = keyPair;
    if (!privateKey || !publicKey) {
      throw new Error("Failed to generate random key pair");
    }
    let pk = publicKey.toString("hex");

    pk = pk.slice(2);

    return {
      privateKey: privateKey.toString("hex"),
      publicKey: publicKey.toString("hex"),
      publicKeyNoCoord: pk,
      keyPair,
    };
  };

  generateRandomStakingTerm = () => {
    return Math.floor(Math.random() * 65535) + 1;
  };

  generateRandomUnbondingTime = (stakingTerm: number) => {
    return Math.floor(Math.random() * stakingTerm) + 1;
  };

  generateRandomFeeRates = () => {
    return Math.floor(Math.random() * 1000) + 1;
  };

  generateRandomCovenantCommittee = (size: number): Buffer[] => {
    const committe: Buffer[] = [];
    for (let i = 0; i < size; i++) {
      const keyPair = this.generateRandomKeyPair();
      committe.push(Buffer.from(keyPair.publicKeyNoCoord, "hex"));
    }
    return committe;
  };

  generateRandomTag = () => {
    const buffer = Buffer.alloc(4);
    for (let i = 0; i < 4; i++) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
    return buffer;
  };

  generateRandomGlobalParams = (stakingTerm: number, committeeSize: number) => {
    const covenantPks = this.generateRandomCovenantCommittee(committeeSize).map(
      (buffer) => buffer.toString("hex"),
    );
    const covenantQuorum = Math.floor(Math.random() * (committeeSize - 1)) + 1;
    const unbondingTime = this.generateRandomUnbondingTime(stakingTerm);
    const tag = this.generateRandomTag().toString("hex");
    return {
      covenantPks,
      covenantQuorum,
      unbondingTime,
      tag,
    };
  };

  getTaprootAddress = (publicKey: string) => {
    if (publicKey.length == 66) {
      publicKey = publicKey.slice(2);
    }
    const internalPubkey = Buffer.from(publicKey, "hex");
    const { address, output: scriptPubKey } = bitcoin.payments.p2tr({
      internalPubkey,
      network: this.network,
    });
    if (!address || !scriptPubKey) {
      throw new Error(
        "Failed to generate taproot address or script from public key",
      );
    }
    return {
      address,
      scriptPubKey: scriptPubKey.toString("hex"),
    };
  };

  getNativeSegwitAddress = (publicKey: string) => {
    const internalPubkey = Buffer.from(publicKey, "hex");
    const { address, output: scriptPubKey } = bitcoin.payments.p2wpkh({
      pubkey: internalPubkey,
      network: this.network,
    });
    if (!address || !scriptPubKey) {
      throw new Error(
        "Failed to generate native segwit address or script from public key",
      );
    }
    return {
      address,
      scriptPubKey: scriptPubKey.toString("hex"),
    };
  };

  getNetwork = () => {
    return this.network;
  };

  generateMockStakingScripts = (): StakingScripts => {
    const finalityProviderPk = this.generateRandomKeyPair().publicKeyNoCoord;
    const stakingTxTimelock = this.generateRandomStakingTerm();
    const publicKeyNoCoord = this.generateRandomKeyPair().publicKeyNoCoord;
    const committeeSize = Math.floor(Math.random() * 10) + 1;
    const globalParams = this.generateRandomGlobalParams(
      stakingTxTimelock,
      committeeSize,
    );

    // Convert covenant PKs to buffers
    const covenantPKsBuffer = globalParams.covenantPks.map((pk: string) =>
      Buffer.from(pk, "hex"),
    );

    // Create staking script data
    let stakingScriptData;
    try {
      stakingScriptData = new StakingScriptData(
        Buffer.from(publicKeyNoCoord, "hex"),
        [Buffer.from(finalityProviderPk, "hex")],
        covenantPKsBuffer,
        globalParams.covenantQuorum,
        stakingTxTimelock,
        globalParams.unbondingTime,
        Buffer.from(globalParams.tag, "hex"),
      );
    } catch (error: Error | any) {
      throw new Error(error?.message || "Cannot build staking script data");
    }

    let scripts;
    try {
      scripts = stakingScriptData.buildScripts();
    } catch (error: Error | any) {
      throw new Error(error?.message || "Error while recreating scripts");
    }

    if (process.env.DUMP_DECODE_MINISCRIPT) {
      decodeScriptsToMiniscript(scripts);
    }

    const mini = new StakingScriptDataMini(
      Buffer.from(publicKeyNoCoord, "hex"),
      [Buffer.from(finalityProviderPk, "hex")],
      covenantPKsBuffer,
      globalParams.covenantQuorum,
      stakingTxTimelock,
      globalParams.unbondingTime,
      Buffer.from(globalParams.tag, "hex"),
    ).buildScripts();

    assertEqualScripts(scripts, mini);

    return scripts;
  };

  getAddressAndScriptPubKey = (publicKey: string) => {
    return {
      taproot: this.getTaprootAddress(publicKey),
      nativeSegwit: this.getNativeSegwitAddress(publicKey),
    };
  };

  generateRandomUTXOs = (
    minAvailableBalance: number,
    numberOfUTXOs: number,
    publicKey?: string,
  ): UTXO[] => {
    const utxos = [];
    let sum = 0;
    for (let i = 0; i < numberOfUTXOs; i++) {
      const { nativeSegwit } = this.getAddressAndScriptPubKey(
        publicKey ? publicKey : this.generateRandomKeyPair().publicKey,
      );

      utxos.push({
        txid: this.generateRandomTxId(),
        vout: Math.floor(Math.random() * 10),
        scriptPubKey: nativeSegwit.scriptPubKey,
        value: Math.floor(Math.random() * 9000) + minAvailableBalance,
      });
      sum += utxos[i].value;
      if (sum >= minAvailableBalance) {
        break;
      }
    }
    return utxos;
  };

  generateRandomStakingTransaction = (
    network: bitcoin.Network,
    feeRate: number,
    keyPair: KeyPair,
    address: string,
    stakingScripts: StakingScripts,
  ) => {
    const randomAmount = Math.floor(Math.random() * 100000000) + 1000;

    const utxos = this.generateRandomUTXOs(
      Math.floor(Math.random() * 1000000) + randomAmount,
      Math.floor(Math.random() * 10) + 1,
      keyPair.publicKey,
    );

    const { psbt } = stakingTransaction(
      stakingScripts,
      randomAmount,
      address,
      utxos,
      network,
      feeRate,
    );

    return psbt
      .signAllInputs(keyPair.keyPair)
      .finalizeAllInputs()
      .extractTransaction();
  };
}

export default DataGenerator;
