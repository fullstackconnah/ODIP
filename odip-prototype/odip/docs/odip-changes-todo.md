# ODIP Changes

## Navbar
- [ ] To make room for adding in the other revenue stream management as options that can be managed, all trip related navbar items should be moved into a submenu off of Trips

## Participants
- [ ] Update "Wheelchair" field to be labelled "Mobility Aids"
  - [ ] Move from Boolean to Enum with the following options: Wheelchair, Walker
  - [ ] Explore options for specified mobility support, e.g. can transfer wheelchair to vehicle or travel in vehicle in wheelchair, out and about only, or bare weight. Some are vehicle-specific and others are for other support options like changing
- [ ] Update "Overnight Support" field
  - [ ] Move from Boolean to Enum with the following options: Active Night, Overnight Sleepover
  - [ ] An overnight ratio is also required, with the default being 1:1
- [ ] Add checkboxes for equipment
  - [ ] Hi-Lo bed, hoist, shower chair, commode, standing machine
  - [ ] Have the equipment notes field disabled until an equipment checkbox is enabled. A tooltip should tell the user that if they want to add a note they need to select an equipment option first
