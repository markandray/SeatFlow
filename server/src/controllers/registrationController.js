const asyncHandler = require('../utils/asyncHandler');
const registrationService = require('../services/registrationService');

const register = asyncHandler(async (req, res) => {
  const result = await registrationService.register(req.params.id, req.user._id);
  res.status(201).json(result);
});

const getMine = asyncHandler(async (req, res) => {
  const result = await registrationService.getMyRegistrations(req.user._id);
  res.status(200).json(result);
});

const cancel = asyncHandler(async (req, res) => {
  const registration = await registrationService.cancelRegistration(req.params.id, req.user._id);
  res.status(200).json({ registration });
});

const claim = asyncHandler(async (req, res) => {
  const registration = await registrationService.claimOffer(req.params.id, req.user._id);
  res.status(200).json({ registration, serverTime: new Date().toISOString() });
});

const decline = asyncHandler(async (req, res) => {
  const registration = await registrationService.declineOffer(req.params.id, req.user._id);
  res.status(200).json({ registration });
});

module.exports = {
  register,
  getMine,
  cancel,
  claim,
  decline,
};
