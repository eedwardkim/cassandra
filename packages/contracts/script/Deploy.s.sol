// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CalibrationLedger} from "../src/CalibrationLedger.sol";
import {AgentPolicy} from "../src/AgentPolicy.sol";

interface Vm {
    function envUint(string calldata) external view returns (uint256);
    function addr(uint256) external pure returns (address);
    function startBroadcast(uint256) external;
    function stopBroadcast() external;
}

/// Deploys both contracts and sets the initial policy: $25.00/trade, $200.00/day, 300 bps min edge, all categories.
/// The engine's `pnpm deploy:testnet` runs the same steps through viem and writes packages/shared/deployments/<network>.json.
contract Deploy {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (CalibrationLedger ledger, AgentPolicy policy) {
        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        address agent = vm.addr(vm.envUint("AGENT_PRIVATE_KEY"));
        vm.startBroadcast(ownerKey);
        ledger = new CalibrationLedger(owner);
        policy = new AgentPolicy(owner);
        policy.setPolicy(agent, AgentPolicy.Policy(2500, 20000, 300, type(uint32).max, false));
        vm.stopBroadcast();
    }
}
