#include "RNOH/PackageProvider.h"
#include "GestureHandlerPackage.h"
#include "generated/RNOHGeneratedPackage.h"

using namespace rnoh;

std::vector<std::shared_ptr<Package>> PackageProvider::getPackages(Package::Context ctx) {
    return {std::make_shared<RNOHGeneratedPackage>(ctx), std::make_shared<GestureHandlerPackage>(ctx)};
}