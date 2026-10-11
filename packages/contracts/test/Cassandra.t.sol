// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CalibrationLedger} from "../src/CalibrationLedger.sol";
import {AgentPolicy} from "../src/AgentPolicy.sol";

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function expectRevert(bytes calldata) external;
    function expectRevert(bytes4) external;
}

contract CassandraTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    CalibrationLedger ledger;
    AgentPolicy policy;
    address owner = address(0xA11CE);
    address agent = address(0xB0B);
    bytes32 key = keccak256(bytes("GEMI-FED261030-HOLD"));
    bytes32 rh = keccak256("reasoning");
    bytes32 salt = keccak256("salt");

    function setUp() public {
        ledger = new CalibrationLedger(owner);
        policy = new AgentPolicy(owner);
        vm.prank(owner);
        policy.setPolicy(agent, AgentPolicy.Policy(2500, 20000, 300, type(uint32).max, false));
    }

    function _commit(uint16 p) internal returns (uint256 id) {
        vm.prank(agent);
        id = ledger.commit(key, keccak256(abi.encode(key, p, rh, salt)));
    }

    function test_commitRevealResolveScoresBrier() public {
        uint256 a = _commit(7000);
        vm.prank(agent);
        ledger.reveal(a, 7000, rh, salt);
        vm.prank(owner);
        ledger.resolve(key, true);
        (uint32 count, uint256 sum, uint256 meanB) = ledger.calibration(agent);
        require(count == 1, "count");
        require(sum == 3000 * 3000, "brier");
        require(meanB == 9_000_000, "mean");
        (,,,,,,, uint8 state) = ledger.commits(a);
        require(state == 2, "scored");
    }

    function test_wrongSaltReverts() public {
        uint256 a = _commit(7000);
        vm.prank(agent);
        vm.expectRevert(CalibrationLedger.BadReveal.selector);
        ledger.reveal(a, 7000, rh, keccak256("other"));
    }

    function test_doubleRevealReverts() public {
        uint256 a = _commit(7000);
        vm.startPrank(agent);
        ledger.reveal(a, 7000, rh, salt);
        vm.expectRevert(CalibrationLedger.BadState.selector);
        ledger.reveal(a, 7000, rh, salt);
        vm.stopPrank();
    }

    function test_onlyResolverResolves() public {
        vm.prank(agent);
        vm.expectRevert(CalibrationLedger.NotResolver.selector);
        ledger.resolve(key, true);
    }

    function test_overLimitRefusedWithReason() public {
        (bool ok, string memory reason) = policy.check(agent, 2600, 500, 3);
        require(!ok && keccak256(bytes(reason)) == keccak256("notional exceeds max per trade"), "reason");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.PolicyViolation.selector, "notional exceeds max per trade"));
        policy.authorizeTrade(key, 2600, 500, 3, bytes32(uint256(1)));
    }

    function test_lowEdgeRefused() public {
        (bool ok, string memory reason) = policy.check(agent, 1000, 200, 3);
        require(!ok && keccak256(bytes(reason)) == keccak256("edge below policy minimum"), "reason");
    }

    function test_pausedRefused() public {
        vm.prank(owner);
        policy.setPaused(agent, true);
        (bool ok, string memory reason) = policy.check(agent, 1000, 500, 3);
        require(!ok && keccak256(bytes(reason)) == keccak256("agent paused by owner"), "reason");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.PolicyViolation.selector, "agent paused by owner"));
        policy.authorizeTrade(key, 1000, 500, 3, bytes32(uint256(1)));
    }

    function test_dayBucketRollover() public {
        vm.warp(10 days);
        vm.startPrank(agent);
        for (uint256 i = 0; i < 8; i++) policy.authorizeTrade(key, 2500, 500, 3, bytes32(i));
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.PolicyViolation.selector, "daily notional limit reached"));
        policy.authorizeTrade(key, 2500, 500, 3, bytes32(uint256(99)));
        vm.warp(11 days);
        policy.authorizeTrade(key, 2500, 500, 3, bytes32(uint256(100)));
        vm.stopPrank();
        require(policy.spentToday(agent) == 2500, "rolled over");
    }

    function test_onlyOwnerSetsPolicy() public {
        vm.prank(agent);
        vm.expectRevert(AgentPolicy.NotOwner.selector);
        policy.setPolicy(agent, AgentPolicy.Policy(1e9, 1e9, 0, type(uint32).max, false));
    }

    function test_settleRefundsUnfilledNotional() public {
        vm.startPrank(agent);
        uint256 id = policy.authorizeTrade(key, 2000, 500, 3, keccak256("cid"));
        require(policy.spentToday(agent) == 2000, "reserved");
        policy.settleTrade(id, keccak256("order"), 600);
        vm.stopPrank();
        require(policy.spentToday(agent) == 600, "refunded unfilled");
    }

    function test_doubleSettleReverts() public {
        vm.startPrank(agent);
        uint256 id = policy.authorizeTrade(key, 2000, 500, 3, keccak256("cid"));
        policy.settleTrade(id, keccak256("order"), 0);
        vm.expectRevert(AgentPolicy.BadState.selector);
        policy.settleTrade(id, keccak256("order"), 0);
        vm.stopPrank();
    }

    function test_nonAgentSettleReverts() public {
        vm.prank(agent);
        uint256 id = policy.authorizeTrade(key, 2000, 500, 3, keccak256("cid"));
        vm.prank(owner);
        vm.expectRevert(AgentPolicy.NotAgent.selector);
        policy.settleTrade(id, keccak256("order"), 0);
    }

    function test_overFillReverts() public {
        vm.startPrank(agent);
        uint256 id = policy.authorizeTrade(key, 2000, 500, 3, keccak256("cid"));
        vm.expectRevert(AgentPolicy.OverFilled.selector);
        policy.settleTrade(id, keccak256("order"), 2001);
        vm.stopPrank();
    }

    function test_dailyCapCountsUnsettledReservations() public {
        vm.startPrank(agent);
        for (uint256 i = 0; i < 8; i++) policy.authorizeTrade(key, 2500, 500, 3, bytes32(i));
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.PolicyViolation.selector, "daily notional limit reached"));
        policy.authorizeTrade(key, 100, 500, 3, bytes32(uint256(99)));
        vm.stopPrank();
    }

    function test_strangerCannotAuthorize() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(abi.encodeWithSelector(AgentPolicy.PolicyViolation.selector, "no policy set for agent"));
        policy.authorizeTrade(key, 100, 500, 3, bytes32(0));
    }

    function test_transferOwnershipMovesTheLeash() public {
        vm.prank(owner);
        policy.transferOwnership(address(0xCAFE));
        vm.prank(owner);
        vm.expectRevert(AgentPolicy.NotOwner.selector);
        policy.setPaused(agent, true);
        vm.prank(address(0xCAFE));
        policy.setPaused(agent, true);
    }
}
