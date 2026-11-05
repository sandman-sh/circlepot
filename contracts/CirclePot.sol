// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CirclePot
/// @notice Small, transparent rotating savings circles using Portaldot's native EVM currency.
/// @dev Payouts and refunds are credited to `pendingReturns` and withdrawn with `claimReturns`
///      (pull pattern), so one member whose wallet rejects native currency can never block a
///      round or a refund for everyone else. The contract has no owner, fee, or custodian path:
///      funds only ever move to members as contributions, scheduled pots, or refunds.
contract CirclePot {
    uint256 public constant MIN_REFUND_WINDOW = 1 days;
    uint256 public constant MAX_REFUND_WINDOW = 30 days;
    uint8 public constant MAX_MEMBERS = 12;

    struct Circle {
        string name;
        address creator;
        uint96 contribution;
        uint8 maxMembers;
        uint256 currentRound;
        bool open;
        uint8 contributionCount;
        uint256 roundPot;
        uint64 roundStartedAt;
        uint32 refundWindow;
        bool completed;
        bool cancelled;
        bool inviteOnly;
    }

    struct CircleView {
        uint256 id;
        string name;
        address creator;
        uint96 contribution;
        uint8 maxMembers;
        uint8 memberCount;
        uint256 currentRound;
        bool open;
        uint8 contributionCount;
        uint256 roundPot;
        uint64 roundStartedAt;
        uint32 refundWindow;
        bool completed;
        bool cancelled;
        bool inviteOnly;
    }

    uint256 public circleCount;
    mapping(uint256 => Circle) private circles;
    mapping(uint256 => address[]) private circleMembers;
    mapping(uint256 => mapping(address => bool)) public isMember;
    mapping(uint256 => mapping(address => bool)) public hasContributed;
    mapping(uint256 => mapping(address => bool)) public isInvited;
    /// @notice POT credited to an address (scheduled pots + refunds), withdrawn via claimReturns().
    mapping(address => uint256) public pendingReturns;

    uint256 private lock = 1;

    event CircleCreated(uint256 indexed circleId, address indexed creator, string name, uint96 contribution, uint8 maxMembers, uint32 refundWindow, bool inviteOnly);
    event MemberJoined(uint256 indexed circleId, address indexed member, uint8 seat);
    event MemberLeft(uint256 indexed circleId, address indexed member);
    event CircleCancelled(uint256 indexed circleId, address indexed creator);
    event CircleCompleted(uint256 indexed circleId);
    event ContributionMade(uint256 indexed circleId, uint256 indexed round, address indexed member, uint96 amount, uint8 paidCount);
    event RoundPaid(uint256 indexed circleId, uint256 indexed round, address indexed recipient, uint256 amount);
    event RoundRefunded(uint256 indexed circleId, uint256 indexed round, uint256 amount);
    event ReturnsClaimed(address indexed member, uint256 amount);

    modifier nonReentrant() {
        require(lock == 1, "Reentrant call");
        lock = 2;
        _;
        lock = 1;
    }

    function createCircle(
        string calldata name,
        uint96 contribution,
        uint8 maxMembers,
        uint32 refundWindowDays,
        address[] calldata invited
    ) external returns (uint256 circleId) {
        require(bytes(name).length > 0 && bytes(name).length <= 48, "Name must be 1-48 bytes");
        require(contribution > 0, "Contribution must be positive");
        require(maxMembers >= 2 && maxMembers <= MAX_MEMBERS, "Circle size must be 2-12");
        require(refundWindowDays >= 1 && refundWindowDays <= 30, "Refund window must be 1-30 days");
        require(invited.length <= MAX_MEMBERS, "Too many invited addresses");

        circleId = circleCount++;
        Circle storage circle = circles[circleId];
        circle.name = name;
        circle.creator = msg.sender;
        circle.contribution = contribution;
        circle.maxMembers = maxMembers;
        circle.currentRound = 0;
        circle.open = true;
        circle.contributionCount = 0;
        circle.roundPot = 0;
        circle.roundStartedAt = 0;
        circle.refundWindow = uint32(refundWindowDays * 1 days);
        circle.completed = false;
        circle.cancelled = false;
        circle.inviteOnly = invited.length > 0;
        if (invited.length > 0) {
            isInvited[circleId][msg.sender] = true; // The creator can always take a seat.
            for (uint256 i; i < invited.length; ++i) {
                require(invited[i] != address(0), "Invited address cannot be zero");
                isInvited[circleId][invited[i]] = true;
            }
        }
        emit CircleCreated(circleId, msg.sender, name, contribution, maxMembers, circle.refundWindow, circle.inviteOnly);
    }

    function joinCircle(uint256 circleId) external {
        Circle storage circle = circles[circleId];
        require(bytes(circle.name).length != 0, "Circle not found");
        require(!circle.cancelled && !circle.completed, "Circle is closed");
        require(circle.open, "Circle is full");
        require(!isMember[circleId][msg.sender], "Already a member");
        require(!circle.inviteOnly || isInvited[circleId][msg.sender], "This circle is invite-only");

        address[] storage members = circleMembers[circleId];
        require(members.length < circle.maxMembers, "Circle is full");
        members.push(msg.sender);
        isMember[circleId][msg.sender] = true;
        uint8 seat = uint8(members.length - 1);
        if (members.length == circle.maxMembers) circle.open = false;
        emit MemberJoined(circleId, msg.sender, seat);
    }

    /// @notice Leave while the circle is still filling. No contributions exist yet at that
    ///         stage, so no funds move; the remaining seats keep their relative order.
    function leaveCircle(uint256 circleId) external {
        Circle storage circle = circles[circleId];
        require(bytes(circle.name).length != 0, "Circle not found");
        require(circle.open && !circle.cancelled, "Seats are locked once the circle is full");
        require(isMember[circleId][msg.sender], "Not a member");
        address[] storage members = circleMembers[circleId];
        for (uint256 i; i < members.length; ++i) {
            if (members[i] == msg.sender) {
                for (uint256 j = i; j + 1 < members.length; ++j) members[j] = members[j + 1];
                members.pop();
                break;
            }
        }
        isMember[circleId][msg.sender] = false;
        emit MemberLeft(circleId, msg.sender);
    }

    /// @notice The creator can cancel while the circle is still filling. No funds are held
    ///         before a circle fills, so cancellation never traps contributions.
    function cancelCircle(uint256 circleId) external {
        Circle storage circle = circles[circleId];
        require(bytes(circle.name).length != 0, "Circle not found");
        require(msg.sender == circle.creator, "Only the creator can cancel");
        require(circle.open && !circle.cancelled && !circle.completed, "Circle can no longer be cancelled");
        circle.cancelled = true;
        circle.open = false;
        emit CircleCancelled(circleId, msg.sender);
    }

    function contribute(uint256 circleId) external payable nonReentrant {
        Circle storage circle = circles[circleId];
        address[] storage members = circleMembers[circleId];
        require(!circle.completed && !circle.cancelled, "Circle is closed");
        require(!circle.open && members.length >= 2, "Circle is not ready");
        require(isMember[circleId][msg.sender], "Join this circle first");
        require(!hasContributed[circleId][msg.sender], "Already paid this round");
        require(msg.value == circle.contribution, "Send the exact contribution");

        if (circle.contributionCount == 0) circle.roundStartedAt = uint64(block.timestamp);
        hasContributed[circleId][msg.sender] = true;
        circle.roundPot += uint96(msg.value);
        circle.contributionCount += 1;
        uint8 paidCount = circle.contributionCount;
        uint256 paidRound = circle.currentRound;
        emit ContributionMade(circleId, paidRound, msg.sender, uint96(msg.value), paidCount);

        if (paidCount == members.length) {
            address recipient = members[paidRound % members.length];
            uint256 payout = circle.roundPot;
            circle.roundPot = 0;
            circle.contributionCount = 0;
            circle.roundStartedAt = 0;
            for (uint256 i; i < members.length; ++i) hasContributed[circleId][members[i]] = false;
            circle.currentRound = paidRound + 1;
            // Credit, never push: the recipient withdraws with claimReturns(), so a wallet
            // that rejects native currency cannot block the round for everyone else.
            pendingReturns[recipient] += payout;
            emit RoundPaid(circleId, paidRound, recipient, payout);
            if (circle.currentRound >= members.length) {
                circle.completed = true;
                emit CircleCompleted(circleId);
            }
        }
    }

    /// @notice Lets anyone release a partially funded round after the circle's refund window.
    ///         Each contributor is credited their exact contribution to claim when ready.
    function refundExpiredRound(uint256 circleId) external {
        Circle storage circle = circles[circleId];
        require(!circle.completed && !circle.cancelled, "Circle is closed");
        require(circle.contributionCount > 0, "No contributions to refund");
        require(block.timestamp >= uint256(circle.roundStartedAt) + circle.refundWindow, "Round has not expired");

        address[] storage members = circleMembers[circleId];
        uint96 amount = circle.contribution;
        uint256 totalRefunded = circle.roundPot;
        circle.roundPot = 0;
        circle.contributionCount = 0;
        circle.roundStartedAt = 0;
        uint256 refundedRound = circle.currentRound;
        for (uint256 i; i < members.length; ++i) {
            address member = members[i];
            if (hasContributed[circleId][member]) {
                hasContributed[circleId][member] = false;
                pendingReturns[member] += amount;
            }
        }
        emit RoundRefunded(circleId, refundedRound, totalRefunded);
    }

    /// @notice Withdraw everything credited to you (scheduled pots and refunds).
    function claimReturns() external nonReentrant {
        uint256 amount = pendingReturns[msg.sender];
        require(amount > 0, "Nothing to claim");
        pendingReturns[msg.sender] = 0;
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        require(sent, "Claim failed");
        emit ReturnsClaimed(msg.sender, amount);
    }

    function getCircle(uint256 circleId) external view returns (
        string memory name,
        address creator,
        uint96 contribution,
        uint8 maxMembers,
        uint8 memberCount,
        uint256 currentRound,
        bool open,
        uint8 contributionCount,
        uint256 roundPot,
        uint64 roundStartedAt,
        uint32 refundWindow,
        bool completed,
        bool cancelled,
        bool inviteOnly
    ) {
        Circle storage circle = circles[circleId];
        require(bytes(circle.name).length != 0, "Circle not found");
        return (
            circle.name, circle.creator, circle.contribution, circle.maxMembers,
            uint8(circleMembers[circleId].length), circle.currentRound, circle.open,
            circle.contributionCount, circle.roundPot, circle.roundStartedAt,
            circle.refundWindow, circle.completed, circle.cancelled, circle.inviteOnly
        );
    }

    function getMembers(uint256 circleId) external view returns (address[] memory) {
        require(bytes(circles[circleId].name).length != 0, "Circle not found");
        return circleMembers[circleId];
    }

    function getContributionState(uint256 circleId, address member) external view returns (bool) {
        return hasContributed[circleId][member];
    }

    /// @notice Newest-first page of circles for list views.
    function getCirclesPage(uint256 offset, uint256 limit) external view returns (CircleView[] memory page) {
        uint256 total = circleCount;
        if (offset >= total || limit == 0) return new CircleView[](0);
        uint256 count = limit;
        if (offset + count > total) count = total - offset;
        page = new CircleView[](count);
        for (uint256 i; i < count; ++i) {
            uint256 id = total - 1 - offset - i;
            Circle storage circle = circles[id];
            page[i] = CircleView({
                id: id,
                name: circle.name,
                creator: circle.creator,
                contribution: circle.contribution,
                maxMembers: circle.maxMembers,
                memberCount: uint8(circleMembers[id].length),
                currentRound: circle.currentRound,
                open: circle.open,
                contributionCount: circle.contributionCount,
                roundPot: circle.roundPot,
                roundStartedAt: circle.roundStartedAt,
                refundWindow: circle.refundWindow,
                completed: circle.completed,
                cancelled: circle.cancelled,
                inviteOnly: circle.inviteOnly
            });
        }
    }

    /// @notice Every circle an address holds a seat in (ids ascending).
    function getUserCircles(address user) external view returns (uint256[] memory ids) {
        uint256 found;
        for (uint256 i; i < circleCount; ++i) if (isMember[i][user]) found++;
        ids = new uint256[](found);
        uint256 cursor;
        for (uint256 i; i < circleCount; ++i) {
            if (isMember[i][user]) ids[cursor++] = i;
        }
    }
}
