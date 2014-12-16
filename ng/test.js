﻿angular.module("managePortal", ["ngRoute", "ngAnimate", "ngSanitize", "ui.bootstrap", "angularBootstrapNavTree", "rx"])
    .controller("bodyController", function ($scope, $routeParams, $location, $http, $q, $timeout, rx) {

        $scope.jsonHtml = "select something";
        $scope.treeControl = {};
        $scope.resourcesDefinitionsTable = [];
        $scope.resources = [];
        var editor;
        $timeout(function () {
            editor = ace.edit("jsoneditor");//new JSONEditor(document.getElementById("jsoneditor"));
            editor.setOptions({
                maxLines: Infinity,
                fontSize: 15
            });
            editor.setTheme("ace/theme/tomorrow");
            editor.getSession().setMode("ace/mode/json");
        });

        $scope.$createObservableFunction("selectResourceHandler")
            .flatMapLatest(selectResource)
            .do(function () {}, function (err) {
                $scope.invoking = false;
                $scope.loading = false;
                if (err.config && err.config.resourceDefinition && !isEmptyObjectorArray(err.config.resourceDefinition.requestBody)) {
                    var resourceDefinition = err.config.resourceDefinition;
                    $scope.putUrl = err.config.filledInUrl;
                    delete err.config.resourceDefinition;
                    delete err.config.filledInUrl;
                    var editable = jQuery.extend(true, {}, resourceDefinition.requestBody);
                    editor.setValue(JSON.stringify(editable, undefined, 4));
                    editor.session.selection.clearSelection();
                    $scope.show = true;
                    $scope.jsonHtml = ""
                }
                $scope.errorResponse = syntaxHighlight(err);
            })
            .retry()
            .subscribe(function (value) {
                delete $scope.putError;
                $scope.invoking = false;
                $scope.loading = false;
                if (value.data === undefined) {
                    if (value.resourceDefinition !== undefined && !isEmptyObjectorArray(value.resourceDefinition.requestBody)) {
                        var editable = jQuery.extend(true, {}, value.resourceDefinition.requestBody);
                        editor.setValue(JSON.stringify(editable, undefined, 4));
                        editor.session.selection.clearSelection();
                        $scope.show = true;
                        $scope.jsonHtml = "";
                    } else {
                        editor.setValue("");
                        $scope.show = false;
                        $scope.jsonHtml = "No GET Url";
                    }
                    return;
                }
                var data = value.data;
                var resourceDefinition = value.resourceDefinition;
                var url = value.url;
                $scope.jsonHtml = syntaxHighlight(data);
                $scope.rawData = data;
                $scope.putUrl = url;
                var putActions = resourceDefinition.actions.filter(function (a) { return (a === "POST" || a === "PUT"); });
                if (putActions.length === 1) {
                    var editable = jQuery.extend(true, {}, resourceDefinition.requestBody);
                    mergeObject($scope.rawData, editable);
                    editor.setValue(JSON.stringify(editable, undefined, 4));
                    editor.session.selection.clearSelection();
                    $scope.show = true;
                    if (url.endsWith("list")) {
                        $scope.putUrl = url.substring(0, url.lastIndexOf("/"));
                    }
                } else {
                    editor.setValue("");
                    $scope.show = false;
                }

                var actionsAndVerbs = resourceDefinition.actions.filter(function (a) { return (a === "DELETE"); }).map(function (a) {
                    return {
                        httpMethod: a,
                        name: "Delete",
                        url: url
                    };
                });
                if (Array.isArray(resourceDefinition.children))
                    Array.prototype.push.apply(actionsAndVerbs, resourceDefinition.children.filter(function (childString) {
                        var d = $scope.resourcesDefinitionsTable.filter(function (r) {
                            return (r.resourceName === childString) && ((r.url === resourceDefinition.url) || r.url === (resourceDefinition.url + "/" + childString));
                        });
                        return d.length === 1;
                    }).map(function (childString) {
                        var d = getResourceDefinitionByNameAndUrl(childString, resourceDefinition.url + "/" + childString);
                        if (d.children === undefined && Array.isArray(d.actions) && d.actions.filter(function (actionName) { return actionName === "POST" }).length > 0) {
                            return {
                                httpMethod: "POST",
                                name: d.resourceName,
                                url: url + "/" + d.resourceName
                            };
                        }
                    }).filter(function(r) {return r !== undefined;}));

                $scope.selectedResource = {
                    url: url,
                    actionsAndVerbs: actionsAndVerbs,
                    httpMethod: value.httpMethod,
                };
            });

        $scope.invokeAction = function (action, url) {
            $scope.loading = true;
            delete $scope.actionResponse;
            $http({
                method: "POST",
                url: "api/operations",
                data: {
                    Url: url,
                    HttpMethod: action
                }
            }).success(function(data){
                $scope.actionResponse = syntaxHighlight(data);
                $scope.loading = false;
                var currentBranch = $scope.treeControl.get_selected_branch();
                var parent = $scope.treeControl.get_parent_branch(currentBranch);
                if (action === "DELETE") {
                    $scope.treeControl.select_branch(parent);
                    parent.children = parent.children.filter(function (branch) { return branch.uid !== currentBranch.uid; });
                    $timeout(function () {
                        $("html, body").scrollTop(0);
                        $("#data-tab").find('a:first').click();
                    }, 900);
                } else {
                    $scope.selectResourceHandler($scope.treeControl.get_selected_branch(), undefined);
                    $("html, body").scrollTop(0);
                }

            }).error(function(err){
                $scope.loading = false;
                $scope.actionResponse = syntaxHighlight(err);
            });
        };

        $scope.invokePut = function () {
            delete $scope.putError;
            var userObject = JSON.parse(editor.getValue());
            cleanObject(userObject);
            $scope.invoking = true;
            $http({
                method: "POST",
                url: "api/operations",
                data: {
                    Url: $scope.putUrl,
                    HttpMethod: "PUT",
                    RequestBody: userObject
                }
            }).error(function (err) {
                $scope.putError = syntaxHighlight(err);
                $scope.invoking = false;
                $scope.loading = false;
            }).success(function () {
                $scope.selectResourceHandler($scope.treeControl.get_selected_branch(), undefined);
            });
        };

        $scope.expandResourceHandler = function (branch, row, event) {
            if (branch.is_leaf) return;

            if (branch.expanded) {
                // clear the children array on collapse
                branch.children.length = 0;
                $scope.treeControl.collapse_branch(branch);
                return;
            }

            var resourceDefinition = branch.resourceDefinition;
            if (!resourceDefinition) return;

            if (Array.isArray(resourceDefinition.children)) {
                //TODO
                branch.children = resourceDefinition.children.map(function (childName) {
                    var childDefinition = getResourceDefinitionByNameAndUrl(childName, resourceDefinition.url + "/" + childName);
                    if (!childDefinition) return;
                    if (childDefinition.children === undefined && Array.isArray(childDefinition.actions) && childDefinition.actions.filter(function (actionName) { return actionName === "POST" }).length > 0) return;
                    return {
                        label: childName,
                        resourceDefinition: childDefinition,
                        is_leaf: (childDefinition.children ? false : true)
                    };
                }).filter(function (f) { return f !== undefined; });
                if (branch.children.length === 1)
                    $timeout(function () {
                        $scope.expandResourceHandler($scope.treeControl.get_first_child(branch));
                    });
            } else if (typeof resourceDefinition.children === "string") {
                var getUrl = injectTemplateValues(resourceDefinition.url, branch);

                var originalTreeIcon = row ? row.tree_icon : "icon-plus  glyphicon glyphicon-plus fa fa-plus";
                $(document.getElementById("expand-icon-" + branch.uid)).removeClass(originalTreeIcon).addClass("fa fa-refresh fa-spin");
                var httpConfig = (getUrl.endsWith("resourceGroups") || getUrl.endsWith("subscriptions") || getUrl.split("/").length === 3)
                  ? {
                      method: "GET",
                      url: "api" + getUrl.substring(getUrl.indexOf("/subscriptions")),
                  }
                  : {
                      method: "POST",
                      url: "api/operations",
                      data: {
                          Url: getUrl,
                          HttpMethod: "GET"
                      }
                  };
                return $http(httpConfig).success(function (data) {
                    branch.children = (data.value ? data.value : data).map(function (d) {
                        var childDefinition = getResourceDefinitionByNameAndUrl(resourceDefinition.children, resourceDefinition.url + "/" + resourceDefinition.children);

                        return {
                            label: (d.displayName ? d.displayName : d.name),
                            resourceDefinition: childDefinition,
                            value: (d.subscriptionId ? d.subscriptionId : d.name),
                            is_leaf: (childDefinition.children ? false : true)
                        };
                    });
                }).finally(function () {
                    $(document.getElementById("expand-icon-" + branch.uid)).removeClass("fa fa-spinner fa-spin").addClass(originalTreeIcon);
                    $scope.treeControl.expand_branch(branch);
                    if (branch.children && branch.children.length === 1)
                        $timeout(function () {
                            $scope.expandResourceHandler($scope.treeControl.get_first_child(branch));
                        });
                });
            } //else if undefined
            $scope.treeControl.expand_branch(branch);
        };

        $scope.tenantSelect = function () {
            window.location = "api/tenants/" + $scope.selectedTenant.id;
        };

        // Get resourcesDefinitions
        initResourcesDefinitions();

        // Get tenants list
        initTenants();

        function getResourceDefinitionByNameAndUrl(name, url) {
            var resourceDefinitions = $scope.resourcesDefinitionsTable.filter(function (r) {
                return (r.resourceName === name) && ((r.url === url) || r.url === (url + "/" + name));
            });
            if (resourceDefinitions > 1) {
                console.log("ASSERT! dublicate ids in resourceDefinitionsTable");
                console.log(resourceDefinitions);
            }
            return resourceDefinitions[0];
        }

        function initTenants() {
            $http({
                method: "GET",
                url: "api/tenants"
            }).success(function (tenants) {
                $scope.tenants = tenants.map(function (tenant) {
                    return {
                        name: tenant.DisplayName + " (" + tenant.DomainName + ")",
                        id: tenant.TenantId,
                        current: tenant.Current
                    };
                });
                $scope.selectedTenant = $scope.tenants[$scope.tenants.indexOfDelegate(function (tenant) { return tenant.current; })];
            });
        }

        function initResourcesDefinitions() {
            $http({
                method: "GET",
                url: "api/operations"
            }).success(function (operations) {
                operations.sort(function (a, b) {
                    return a.Url.localeCompare(b.Url);
                });
                operations.map(function (operation) {
                    //TODO: remove this
                    operation = fixOperationUrl(operation);

                    buildResourcesDefinitionsTable(operation);

                    $scope.resourcesDefinitionsTable.map(function (r) {
                        if (Array.isArray(r.children)) {
                            r.children.sort();
                        }
                    });
                });

                // Initializes the root nodes for the tree
                $scope.resources = getRootTreeNodes();

            });
        }

        function getRootTreeNodes() {

            return $scope.resourcesDefinitionsTable.filter(function (rd) { return rd.url.split("/").length === 4; })
                .getUnique(function (rd) { return rd.url.split("/")[3]; }).map(function (urd) {
                return {
                    label: urd.url.split("/")[3],
                    resourceDefinition: urd,
                    data: undefined,
                    resource_icon: "fa fa-cube fa-fw",
                    children: []
                };
            });

            //$scope.resourcesDefinitionsTable.map(function (rd) { return { splits: rd.url.split("/"), resourceId: rd.resourceId }; }).filter(function (a) { return a.splits.length > 3; }).map(function (a) {
            //    return { resourceName: a.splits[3], resourceId: a.resourceId };
            //}).getUnique(function (d) { return d.resourceName; }).map(function (s) {
            //    return {
            //        label: s.resourceName,
            //        resourceDefinition: s,
            //        data: undefined,
            //        resource_icon: "fa fa-cube fa-fw",
            //        children: []
            //    };
            //});
        }

        function fixOperationUrl(operation) {
            if (operation.Url.indexOf("SourceControls/{name}") !== -1) {
                operation.Url = operation.Url.replace("SourceControls/{name}", "SourceControls/{sourceControlName}");
            }
            if (operation.Url.indexOf("serverFarms/{name}") !== -1) {
                operation.Url = operation.Url.replace("serverFarms/{name}", "serverFarms/{webHostingPlanName}");
            }
            if (operation.Url.indexOf("resourcegroups") !== -1) {
                operation.Url = operation.Url.replace("resourcegroups", "resourceGroups");
            }
            if (operation.Url.endsWith("/")) {
                operation.Url = operation.Url.substring(0, operation.Url.length - 1);
            }
            return operation;
        }

        function buildResourcesDefinitionsTable(operation, url) {
            url = (operation ? operation.Url : url);
            var segments = url.split("/").filter(function (a) { return a.length !== 0 });
            var resourceName = segments.pop();
            var addedElement;

            if (resourceName === "list" && operation && operation.HttpMethod === "POST") {
                setParent(url, "GETPOST");
                return;
            }

            //set the element itself
            var elements = $scope.resourcesDefinitionsTable.filter(function (r) { return r.url === url });
            if (elements.length === 1) {
                //it's there, update it's actions
                if (operation) {
                    elements[0].requestBody = (elements[0].requestBody ? elements[0].requestBody : operation.RequestBody);
                    if (elements[0].actions.filter(function (c) { return c === operation.HttpMethod }).length === 0) {
                        elements[0].actions.push(operation.HttpMethod);
                    }
                }
            } else {
                addedElement = {
                    resourceName: resourceName,
                    children: undefined,
                    actions: (operation ? [operation.HttpMethod] : []),
                    url: url,
                    requestBody: operation ? operation.RequestBody : {}
                };
                $scope.resourcesDefinitionsTable.push(addedElement);
            }

            // set the parent recursively
            setParent(url);
            return addedElement;
        }

        function setParent(url, action) {
            var segments = url.split("/").filter(function (a) { return a.length !== 0; });
            var resourceName = segments.pop();
            var parentName = url.substring(0, url.lastIndexOf("/"));
            if (parentName === undefined || parentName === "" || resourceName === undefined) return;
            var parents = $scope.resourcesDefinitionsTable.filter(function (rd) { return rd.url === parentName; });
            var parent;
            if (parents.length === 1) {
                parent = parents[0];
                if (resourceName.match(/\{.*\}/g)) {
                    // this means the parent.children should either be an undefined, or a string.
                    // if it's anything else assert! because that means we have a mistake in out assumptions
                    if (parent.children === undefined || typeof parent.children === "string") {
                        parent.children = resourceName;
                    } else {
                        console.log("ASSERT, typeof parent.children: " + typeof parent.children)
                    }
                } else if (resourceName !== "list") {
                    // this means that the resource is a pre-defined one. the parent.children should be undefined or array
                    // if it's anything else assert! because that means we have a mistake in out assumptions
                    if (parent.children === undefined) {
                        parent.children = [resourceName];
                    } else if (Array.isArray(parent.children)) {
                        if (parent.children.filter(function (c) { return c === resourceName; }).length === 0) {
                            parent.children.push(resourceName);
                        }
                    } else {
                        console.log("ASSERT, typeof parent.children: " + typeof parent.children)
                    }
                }
            } else {
                //this means the parent is not in the array. Add it
                parent = buildResourcesDefinitionsTable(undefined, url.substring(0, url.lastIndexOf("/")));
                setParent(url);
            }
            if (action && parent && parent.actions.filter(function (c) { return c === action; }).length === 0) {
                parent.actions.push(action);
            }
        }

        function injectTemplateValues(url, branch) {
            var resourceParent = branch;
            while (resourceParent !== undefined) {
                if (resourceParent.value !== undefined) {
                    url = url.replace(resourceParent.resourceDefinition.resourceName, resourceParent.value);
                }
                resourceParent = $scope.treeControl.get_parent_branch(resourceParent);
            }
            return url;
        }

        function selectResource(args) {
            var branch = args[0];
            var event = args[1];
            fixWidths(event);
            $scope.loading = true;
            delete $scope.errorResponse;
            var resourceDefinition = branch.resourceDefinition;
            if (!resourceDefinition) return rx.Observable.fromPromise($q.when({ branch: branch }));

            var getActions = resourceDefinition.actions.filter(function (a) {
                return (a === "GET" || a === "GETPOST");
            });

            if (getActions.length === 1) {
                var getAction = (getActions[0] === "GETPOST" ? "POST" : "GET");
                var url = (getAction === "POST" ? resourceDefinition.url + "/list" : resourceDefinition.url);
                url = injectTemplateValues(url, branch);
                var httpConfig = (url.endsWith("resourceGroups") || url.endsWith("subscriptions") || url.split("/").length === 3)
                ? {
                    method: "GET",
                    url: "api" + url.substring(url.indexOf("/subscriptions")),
                }
                : {
                    method: "POST",
                    url: "api/operations",
                    data: {
                        Url: url,
                        HttpMethod: getAction
                    },
                    resourceDefinition: resourceDefinition,
                    filledInUrl: url
                };
                $scope.loading = true;
                return rx.Observable.fromPromise($http(httpConfig)).map(function (data) { return { resourceDefinition: resourceDefinition, data: data.data, url: url, branch: branch, httpMethod: getAction }; });
            }
            return rx.Observable.fromPromise($q.when({ branch: branch, resourceDefinition: resourceDefinition }));
        }

        function fixWidths(event) {
            if (!event) return;
            var anchor = $(event.currentTarget);
            var span = $(event.currentTarget).find("span");
            var width = span.width() + parseInt(span.css("left"), 10) + 37;
            anchor.width((width < 280 ? 280 : width) - 20);
        }

        function syntaxHighlight(json) {
            if (typeof json === "string") return escapeHtmlEntities(json);
            var str = JSON.stringify(json, undefined, 4);
            str = escapeHtmlEntities(str);
            return str.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
                var cls = 'number';
                if (/^"/.test(match)) {
                    if (/:$/.test(match)) {
                        cls = 'key';
                    } else {
                        cls = 'string';
                    }
                } else if (/true|false/.test(match)) {
                    cls = 'boolean';
                } else if (/null/.test(match)) {
                    cls = 'null';
                }
                if (cls === 'string' && ((match.slice(0, "\"http://".length) == "\"http://") || (match.slice(0, "\"https://".length) == "\"https://"))) {
                    match = match.replace("/api/", "/");
                    return '<span><a class="json-link" target="_blank" href=' + match + '>' + match + '</a></span>';
                } else {
                    return '<span class="' + cls + '">' + match + '</span>';
                }
            });
        }

        function escapeHtmlEntities(str) {
            return $('<div/>').text(str).html();
        }

        function getRerouceGroupNameFromWebSpaceName(webSpaceName) {
            webSpaceName = webSpaceName.toLowerCase();
            if (!webSpaceName.endsWith("webspace")) {
                return undefined;
            }

            // strip ending webspace
            var ws = webSpaceName.substring(0, webSpaceName.length - 8);
            var index = ws.lastIndexOf('-');
            if (index < 0) {
                return "Default-Web-" + ws;
            }
            else {
                return ws.substring(0, index);
            }
        }

        function isEmptyObjectorArray(obj) {
            if (typeof obj === "number" || typeof obj === "boolean") return false;
            if ($.isEmptyObject(obj)) return true;
            if (obj === null || obj === "" || obj.length === 0) return true;
            return false;
        }

        function cleanObject(obj) {
            for (var property in obj) {
                if (obj.hasOwnProperty(property)) {
                    if (typeof obj[property] === "string" && (/\(.*\)/.test(obj[property]))) {
                        delete obj[property];
                    } else if (Array.isArray(obj[property])) {
                        var toRemove = [];
                        obj[property] = obj[property].filter(function (element) {
                            if (typeof element === "string" && (/\(.*\)/.test(element))) {
                                return false
                            } else if (typeof element === "object" && !$.isEmptyObject(element)) {
                                cleanObject(element);
                            } else if (typeof element === "object" && $.isEmptyObject(element)) {
                                return false;
                            }
                            if ($.isEmptyObject(element)) return false;
                            return true;
                        });
                        if (obj[property].length === 0) delete obj[property];
                    } else if (typeof obj[property] === "object" && !$.isEmptyObject(obj[property])) {
                        cleanObject(obj[property]);
                        if ($.isEmptyObject(obj[property])) delete obj[property];
                    } else if (typeof obj[property] === "object" && $.isEmptyObject(obj[property])) {
                        delete obj[property];
                    }
                }
            }
        }

        function mergeObject(source, target) {
            if (typeof source === "string") {
                target = source;
                return target;
            }
            for (var sourceProperty in source) {
                if (source.hasOwnProperty(sourceProperty) && target.hasOwnProperty(sourceProperty)) {
                    if (!isEmptyObjectorArray(source[sourceProperty]) && (typeof source[sourceProperty] === "object") && !Array.isArray(source[sourceProperty])) {
                        mergeObject(source[sourceProperty], target[sourceProperty]);
                    } else if (Array.isArray(source[sourceProperty]) && Array.isArray(target[sourceProperty])) {
                        var targetModel = target[sourceProperty][0];
                        target[sourceProperty] = source[sourceProperty];
                        target[sourceProperty].push(targetModel);
                    } else if (!isEmptyObjectorArray(source[sourceProperty])) {
                        target[sourceProperty] = source[sourceProperty];
                        
                    }
                }
            }
            return target;
        }
    });

// Global JS fixes
$('label.tree-toggler').click(function () {
    $(this).parent().children('ul.tree').toggle(300);
});
if (typeof String.prototype.startsWith != 'function') {
    String.prototype.startsWith = function (str) {
        return this.slice(0, str.length) == str;
    };
}
if (typeof String.prototype.endsWith != 'function') {
    String.prototype.endsWith = function (str) {
        return this.indexOf(str, this.length - str.length) !== -1;
    };
}

Array.prototype.remove = function (from, to) {
    var rest = this.slice((to || from) + 1 || this.length);
    this.length = from < 0 ? this.length + from : from;
    return this.push.apply(this, rest);
};

Array.prototype.getUnique = function (getValue) {
    var u = {}, a = [];
    for (var i = 0, l = this.length; i < l; ++i) {
        var value = getValue(this[i]);
        if (u.hasOwnProperty(value)) {
            continue;
        }
        a.push(this[i]);
        u[value] = 1;
    }
    return a;
}

//http://devdocs.io/javascript/global_objects/array/indexof
Array.prototype.indexOfDelegate = function (searchElement, fromIndex) {

    var k;

    // 1. Let O be the result of calling ToObject passing
    //    the this value as the argument.
    if (this == null) {
        throw new TypeError('"this" is null or not defined');
    }

    var O = Object(this);

    // 2. Let lenValue be the result of calling the Get
    //    internal method of O with the argument "length".
    // 3. Let len be ToUint32(lenValue).
    var len = O.length >>> 0;

    // 4. If len is 0, return -1.
    if (len === 0) {
        return -1;
    }

    // 5. If argument fromIndex was passed let n be
    //    ToInteger(fromIndex); else let n be 0.
    var n = +fromIndex || 0;

    if (Math.abs(n) === Infinity) {
        n = 0;
    }

    // 6. If n >= len, return -1.
    if (n >= len) {
        return -1;
    }

    // 7. If n >= 0, then Let k be n.
    // 8. Else, n<0, Let k be len - abs(n).
    //    If k is less than 0, then let k be 0.
    k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);

    // 9. Repeat, while k < len
    while (k < len) {
        var kValue;
        // a. Let Pk be ToString(k).
        //   This is implicit for LHS operands of the in operator
        // b. Let kPresent be the result of calling the
        //    HasProperty internal method of O with argument Pk.
        //   This step can be combined with c
        // c. If kPresent is true, then
        //    i.  Let elementK be the result of calling the Get
        //        internal method of O with the argument ToString(k).
        //   ii.  Let same be the result of applying the
        //        Strict Equality Comparison Algorithm to
        //        searchElement and elementK.
        //  iii.  If same is true, return k.
        if (k in O && searchElement(O[k])) {
            return k;
        }
        k++;
    }
    return -1;
};